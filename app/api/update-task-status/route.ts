// ~/agentvault-next/app/api/update-task-status/route.ts
import { NextResponse } from "next/server";
import type { Task } from "@/lib/task-store";
import { getAuthenticatedAddress, sameAddress } from "@/lib/auth";
import { getTaskById, updateTaskStatus, recordEscrowRelease } from "@/lib/task-repo";
import { getClientIp } from "@/lib/request-meta";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import {
  initiateDeveloperControlledWalletsClient,
  generateEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http, type Address } from "viem";
import { arcTestnet } from "viem/chains";

const REPUTATION_REGISTRY_ADDRESS =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;

const CIRCLE_PLATFORM_WALLET_ID = process.env.CIRCLE_PLATFORM_WALLET_ID ?? "";
const CIRCLE_PLATFORM_WALLET_ADDRESS = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "";

const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://arc-testnet.drpc.org"),
});

export const runtime = "nodejs";

type UpdateTaskStatusRequest = {
  taskId?: string;
  status?: Task["status"];
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isAssignedAgent(task: Task, callerAddress: string): boolean {
  return Boolean(task.agentAddress && sameAddress(task.agentAddress, callerAddress));
}

function canTransition(
  task: Task,
  nextStatus: Task["status"],
  callerAddress: string
): boolean {
  const isCreator = sameAddress(task.creatorAddress, callerAddress);
  const isAgent = isAssignedAgent(task, callerAddress);

  if (task.status === "assigned" && nextStatus === "in_progress") return isAgent || isCreator;
  if (task.status === "in_progress" && nextStatus === "completed") return isAgent || isCreator;
  if (task.status === "completed" && nextStatus === "paid") return isCreator;

  return false;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);

  const ipLimit = await checkRateLimit({
    endpoint: "tasks/update-status",
    key: `ip:${ip}`,
    max: 40,
    windowMs: 60_000,
  });

  if (!ipLimit.allowed) {
    logAuditEvent({
      endpoint: "tasks/update-status",
      action: "update_task_status",
      ip,
      status: "rate_limited",
      message: "Too many status update requests",
    });

    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  try {
    const callerAddress = await getAuthenticatedAddress(req);

    if (!callerAddress) {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        ip,
        status: "unauthorized",
        message: "Missing auth session",
      });

      return NextResponse.json(
        { error: "Unauthorized: sign in with wallet first" },
        { status: 401 }
      );
    }

    const actorLimit = await checkRateLimit({
      endpoint: "tasks/update-status",
      key: `actor:${callerAddress.toLowerCase()}`,
      max: 40,
      windowMs: 60_000,
    });

    if (!actorLimit.allowed) {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        actorAddress: callerAddress,
        ip,
        status: "rate_limited",
        message: "Too many status update requests for this wallet",
      });

      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(actorLimit.retryAfterSeconds) } }
      );
    }

    const { taskId, status } = (await req.json()) as UpdateTaskStatusRequest;

    if (!taskId || !status) {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        actorAddress: callerAddress,
        ip,
        status: "validation_error",
        message: "Missing taskId or status",
      });

      return NextResponse.json({ error: "Missing taskId or status" }, { status: 400 });
    }

    if (status === "open" || status === "assigned") {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        actorAddress: callerAddress,
        ip,
        status: "validation_error",
        resourceId: taskId,
        message: "Invalid target status",
      });

      return NextResponse.json({ error: "Invalid target status" }, { status: 400 });
    }

    const task = await getTaskById(taskId);

    if (!task) {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        actorAddress: callerAddress,
        ip,
        status: "not_found",
        resourceId: taskId,
        message: "Task not found",
      });

      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!canTransition(task, status, callerAddress)) {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        actorAddress: callerAddress,
        ip,
        status: "forbidden",
        resourceId: taskId,
        message: "Invalid transition for caller",
      });

      return NextResponse.json(
        { error: "Forbidden: invalid transition for caller" },
        { status: 403 }
      );
    }

    // ------- Handle 'paid' transition -------
    if (status === "paid") {
      const usdcTokenId = process.env.CIRCLE_USDC_TOKEN_ID;
      const apiKey = process.env.CIRCLE_API_KEY;
      const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
      const FEE_BPS = 250; // 2.5%
      const feeAmount = (parseFloat(task.reward) * FEE_BPS / 10000).toFixed(6);
      const agentAmount = (parseFloat(task.reward) - parseFloat(feeAmount)).toFixed(6);

      if (!usdcTokenId || !task.agentAddress || !task.escrowId) {
        await recordEscrowRelease({
          id: task.id,
          releaseTxId: null,
          releaseState: "not_configured",
        });
      } else {
        try {
          if (!apiKey || !entitySecret) {
            throw new Error("Missing Circle credentials");
          }

          await generateEntitySecretCiphertext({ apiKey, entitySecret });

          const circleClient = initiateDeveloperControlledWalletsClient({
            apiKey,
            entitySecret,
          });

          const escrowWallet = await circleClient.getWallet({ id: task.escrowId! });
          const escrowAddress = escrowWallet.data?.wallet?.address;
          const rewardFloat = parseFloat(String(task.reward));
          const feeAmount = Math.floor(rewardFloat * 0.025 * 1e6) / 1e6;
          const agentAmount = Math.round((rewardFloat - feeAmount) * 1e6) / 1e6;
          const payoutTxRes = await circleClient.createTransaction({
            idempotencyKey: crypto.randomUUID(),
            walletAddress: escrowAddress!,
            tokenAddress: "0x3600000000000000000000000000000000000000",
            blockchain: "ARC-TESTNET",
            destinationAddress: task.agentAddress,
            amount: [String(agentAmount)],
            fee: {
              type: "level",
              config: {
                feeLevel: "MEDIUM",
              },
            },
          });

          const payoutTx = payoutTxRes as unknown as { data?: { id?: string } };

          await recordEscrowRelease({
            id: task.id,
            releaseTxId: payoutTx.data?.id ?? null,
            releaseState: "submitted",
          });

          // ---- Protocol fee (2.5%) ----
          if (feeAmount > 0 && CIRCLE_PLATFORM_WALLET_ADDRESS) {
            try {
              await circleClient.createTransaction({
                idempotencyKey: crypto.randomUUID(),
                walletId: task.escrowId!,
                tokenAddress: "0x3600000000000000000000000000000000000000",
                destinationAddress: CIRCLE_PLATFORM_WALLET_ADDRESS,
                amount: [String(feeAmount)],
                fee: { type: "level", config: { feeLevel: "MEDIUM" } },
              });
            } catch (feeError) {
              console.error("[fee] protocol fee transfer failed:", feeError);
            }
          }
          // ---- Reputation bump (non-fatal) ----
          try { const currentRepRaw = await arcClient.readContract({
            address: REPUTATION_REGISTRY_ADDRESS,
            abi: [
              {
                name: "getReputation",
                inputs: [{ name: "addr", type: "address" }],
                outputs: [{ name: "", type: "uint256" }],
                type: "function",
                stateMutability: "view",
              },
            ],
            functionName: "getReputation",
            args: [task.agentAddress as Address],
          });

          const currentRep = Number(currentRepRaw);
          const newScore = currentRep + 1;

          if (!CIRCLE_PLATFORM_WALLET_ID) {
            throw new Error("Missing CIRCLE_PLATFORM_WALLET_ID");
          }

          await circleClient.createContractExecutionTransaction({
            walletId: CIRCLE_PLATFORM_WALLET_ID,
            contractAddress: REPUTATION_REGISTRY_ADDRESS,
            abiFunctionSignature: "recordReputation(address,uint256,string)",
            abiParameters: [
              task.agentAddress,
	      String(newScore),
	      "task_completed",
	    ],
            fee: {
              type: "level",
              config: {
                feeLevel: "MEDIUM",
              },
            },
            idempotencyKey: crypto.randomUUID(),
          });
          } catch (repError) {
            console.error("[rep] onchain write failed:", repError);
          }
        } catch (error) {
          const errDetail = error instanceof Error ? error.message : JSON.stringify(error);
          await recordEscrowRelease({
            id: task.id,
            releaseTxId: null,
            releaseState: "error",
          });

          logAuditEvent({
            endpoint: "tasks/update-status",
            action: "update_task_status",
            actorAddress: callerAddress,
            ip,
            status: "error",
            message: `Escrow payout failed: ${errDetail}`,
          });

          return NextResponse.json(
            { error: `Escrow payout failed: ${errDetail}` },
            { status: 502 }
          );
        }
      }
    }
    // ---------------------------------

    const updated = await updateTaskStatus(task.id, status);

    if (!updated) {
      logAuditEvent({
        endpoint: "tasks/update-status",
        action: "update_task_status",
        actorAddress: callerAddress,
        ip,
        status: "not_found",
        resourceId: taskId,
        message: "Task not found",
      });

      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    logAuditEvent({
      endpoint: "tasks/update-status",
      action: "update_task_status",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: taskId,
      metadata: { status },
    });

    return NextResponse.json({ task: updated });
  } catch (error) {
    logAuditEvent({
      endpoint: "tasks/update-status",
      action: "update_task_status",
      ip,
      status: "error",
      message: getErrorMessage(error),
    });

    return NextResponse.json({ error: "Failed to update task status" }, { status: 500 });
  }
}

