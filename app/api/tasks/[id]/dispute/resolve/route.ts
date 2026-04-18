import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAuthenticatedAddress } from "@/lib/auth";
import { getClientIp } from "@/lib/request-meta";
import { logAuditEvent } from "@/lib/audit-log";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIp(req);

  try {
    const callerAddress = await getAuthenticatedAddress(req);
    if (!callerAddress) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // resolution: "pay_agent" | "refund_creator"
    const { resolution } = await req.json() as { resolution?: string };
    if (!resolution || !["pay_agent", "refund_creator"].includes(resolution)) {
      return NextResponse.json({ error: "resolution must be 'pay_agent' or 'refund_creator'" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status, creator_address, agent_address, reward, escrow_funding_state")
      .eq("id", id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.creator_address.toLowerCase() !== callerAddress.toLowerCase()) {
      return NextResponse.json({ error: "Only the task creator can resolve a dispute" }, { status: 403 });
    }

    if (task.status !== "disputed") {
      return NextResponse.json({ error: "Task is not in disputed state" }, { status: 400 });
    }

    // Find the open dispute
    const { data: dispute, error: disputeError } = await supabase
      .from("disputes")
      .select("id")
      .eq("task_id", id)
      .eq("status", "open")
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: "No open dispute found" }, { status: 404 });
    }

    let transferTxId: string | null = null;
    const destinationAddress = resolution === "pay_agent"
      ? task.agent_address
      : task.creator_address;

    // Circle transfer if escrow was funded
    if (task.escrow_funding_state === "funded" && destinationAddress) {
      const amountInMicroUSDC = (parseFloat(task.reward) * 1_000_000).toFixed(0);

      const client = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY!,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
      });

      const transferResponse = await client.createTransaction({
        walletId: process.env.CIRCLE_PLATFORM_WALLET_ID!,
        tokenAddress: "0x3600000000000000000000000000000000000000",
        destinationAddress,
        amount: [amountInMicroUSDC],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });

      const tx = (transferResponse as unknown as { data?: { id?: string } }).data;
      if (!tx?.id) {
        return NextResponse.json(
          { error: "Circle transfer failed. Dispute not resolved." },
          { status: 502 }
        );
      }
      transferTxId = tx.id;
    }

    const newTaskStatus = resolution === "pay_agent" ? "paid" : "cancelled";
    const disputeStatus = resolution === "pay_agent" ? "resolved_agent" : "resolved_creator";

    // Update dispute
    await supabase
      .from("disputes")
      .update({ status: disputeStatus, resolved_at: new Date().toISOString() })
      .eq("id", dispute.id);

    // Update task
    await supabase
      .from("tasks")
      .update({
        status: newTaskStatus,
        escrow_release_state: transferTxId ? "submitted" : "not_released",
        escrow_release_tx_id: transferTxId,
      })
      .eq("id", id);

    logAuditEvent({
      endpoint: "tasks/dispute/resolve",
      action: "resolve_dispute",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: id,
      metadata: { resolution, transferTxId },
    });

    return NextResponse.json({ success: true, resolution, transferTxId });
  } catch (err) {
    logAuditEvent({ endpoint: "tasks/dispute/resolve", action: "resolve_dispute", ip, status: "error", message: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
