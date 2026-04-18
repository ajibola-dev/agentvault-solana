// ~/agentvault-next/app/api/post-task/route.ts
import { initiateDeveloperControlledWalletsClient, generateEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { recordEscrowFunding } from "@/lib/task-repo";
import { NextResponse } from "next/server";
import type { Task } from "@/lib/task-store";
import { getAuthenticatedAddress } from "@/lib/auth";
import { createTask, listTasks } from "@/lib/task-repo";
import { getClientIp } from "@/lib/request-meta";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";

const USDC_TOKEN_ID = process.env.CIRCLE_USDC_TOKEN_ID!;
const CIRCLE_PLATFORM_WALLET_ID = process.env.CIRCLE_PLATFORM_WALLET_ID ?? "";
const CIRCLE_PLATFORM_WALLET_ADDRESS = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "";

export const runtime = "nodejs";

type PostTaskRequest = {
  title?: string;
  description?: string;
  reward?: string;
  minRep?: number;
  agentId?: string | null;
  walletId?: string;          // Circle wallet ID that owns the USDC
  tags?: string[];
};

type CircleWallet = { id?: string; address?: string };
type CircleTransferResponse = { data?: { id?: string } };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const { code } = error as { code?: unknown };
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit({
    endpoint: "tasks/post",
    key: `ip:${ip}`,
    max: 20,
    windowMs: 60_000,
  });
  if (!ipLimit.allowed) {
    logAuditEvent({
      endpoint: "tasks/post",
      action: "post_task",
      ip,
      status: "rate_limited",
      message: "Too many requests. Please try again later.",
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
        endpoint: "tasks/post",
        action: "post_task",
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
      endpoint: "tasks/post",
      key: `actor:${callerAddress.toLowerCase()}`,
      max: 20,
      windowMs: 60_000,
    });
    if (!actorLimit.allowed) {
      logAuditEvent({
        endpoint: "tasks/post",
        action: "post_task",
        actorAddress: callerAddress,
        ip,
        status: "rate_limited",
        message: "Too many requests for this wallet",
      });
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(actorLimit.retryAfterSeconds) } }
      );
    }

    const { title, description, reward, minRep, agentId, walletId, tags } = await req.json() as PostTaskRequest;

    if (!title || !description || !reward) {
      logAuditEvent({
        endpoint: "tasks/post",
        action: "post_task",
        actorAddress: callerAddress,
        ip,
        status: "validation_error",
        message: "Missing required fields",
      });
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const rewardNum = parseFloat(reward);
    if (isNaN(rewardNum) || rewardNum <= 0) {
      logAuditEvent({
        endpoint: "tasks/post",
        action: "post_task",
        actorAddress: callerAddress,
        ip,
        status: "validation_error",
        message: "Invalid reward amount",
      });
      return NextResponse.json({ error: "Invalid reward amount" }, { status: 400 });
    }

    const apiKey = process.env.CIRCLE_API_KEY!;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET!;

    await generateEntitySecretCiphertext({ apiKey, entitySecret });

    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret,
    });

    const walletSet = await client.createWalletSet({
      name: `AV-Escrow-${title.slice(0, 30)}`,
    });

    const wallets = await client.createWallets({
      blockchains: ["ARC-TESTNET"],
      count: 1,
      walletSetId: walletSet.data?.walletSet?.id ?? "",
      accountType: "SCA",
    });

    const escrowWallet = wallets.data?.wallets?.[0] as CircleWallet | undefined;
    const escrowAddress = escrowWallet?.address ?? null;
    const escrowId = escrowWallet?.id ?? null;
    const taskId = crypto.randomUUID();

    // ---------- USDC transfer to escrow ----------
let escrowFundingTxId: string | null = null;
let escrowFundingState: "not_configured" | "submitted" | "error" = "not_configured";

if (CIRCLE_PLATFORM_WALLET_ADDRESS && USDC_TOKEN_ID && escrowAddress) {
  try {
    const transferResult = await client.createTransaction({
  walletAddress: process.env.CIRCLE_PLATFORM_WALLET_ADDRESS!,
  tokenAddress: "0x3600000000000000000000000000000000000000",
  blockchain: "ARC-TESTNET",
  destinationAddress: escrowAddress,
  amount: [(rewardNum * 1.03).toFixed(6).toString()],
  fee: {
    type: "level",
    config: {
      feeLevel: "MEDIUM",
    },
  },
  idempotencyKey: crypto.randomUUID(),
});

    escrowFundingTxId = transferResult.data?.id ?? null;
    escrowFundingState = "submitted";

    await recordEscrowFunding({
      id: taskId,
      fundingTxId: escrowFundingTxId,
      fundingState: "submitted",
    });
  } catch (error) {
    escrowFundingState = "error";
    logAuditEvent({
      endpoint: "tasks/post",
      action: "transfer_error",
      ip,
      status: "error",
      actorAddress: callerAddress,
      message: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
}
// ---------------------------------------------

    const task: Task = {
      id: taskId,
      title,
      description,
      reward: rewardNum.toString(),
      minRep: minRep ?? 50,
      creatorAddress: callerAddress,
      agentId: agentId ?? null,
      status: "open",
      escrowAddress,
      escrowId,
      escrowStatus: escrowAddress ? "wallet_created" : "pending",
      escrowFundingTxId,
      escrowFundingState,
      escrowReleaseTxId: null,
      escrowReleaseState: "not_released",
      ciphertext: "",
      createdAt: new Date().toISOString(),
      tags: tags ?? [],
    };

    await createTask(task);

    logAuditEvent({
      endpoint: "tasks/post",
      action: "post_task",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: task.id,
    });

    return NextResponse.json({ task });
  } catch (err: unknown) {
    logAuditEvent({
      endpoint: "tasks/post",
      action: "post_task",
      ip,
      status: "error",
      message: getErrorMessage(err),
    });
    return NextResponse.json(
      { error: getErrorMessage(err), code: getErrorCode(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}

