import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { callerAddress } = await req.json();

    if (!callerAddress) {
      return NextResponse.json(
        { error: "callerAddress required" },
        { status: 400 }
      );
    }

    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, status, creator_address, reward, escrow_funding_state, escrow_release_state")
      .eq("id", id)
      .single();

    if (fetchError || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.creator_address.toLowerCase() !== callerAddress.toLowerCase()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (task.status !== "open") {
      return NextResponse.json(
        { error: `Cannot cancel a task with status '${task.status}'. Only open tasks can be cancelled.` },
        { status: 400 }
      );
    }

    let refundTxId: string | null = null;

    if (task.escrow_funding_state === "funded") {
      const amountInMicroUSDC = (parseFloat(task.reward) * 1_000_000).toFixed(0);

      const client = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY!,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
      });

      const transferResponse = await client.createTransaction({
        walletId: process.env.CIRCLE_PLATFORM_WALLET_ID!,
        tokenAddress: "0x3600000000000000000000000000000000000000",
        destinationAddress: task.creator_address,
        amount: [amountInMicroUSDC],
        fee: {
          type: "level",
          config: { feeLevel: "MEDIUM" },
        },
      });

      const tx = (transferResponse as unknown as { data?: { id?: string } }).data;

      if (!tx?.id) {
        return NextResponse.json(
          { error: "Circle transfer failed — escrow not refunded. Task not cancelled." },
          { status: 502 }
        );
      }

      refundTxId = tx.id;
    }

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "cancelled",
        escrow_release_state: task.escrow_funding_state === "funded" ? "refunded" : "not_released",
        escrow_release_tx_id: refundTxId,
      })
      .eq("id", id);

    if (updateError) {
      console.error(
        `[cancel] CRITICAL: Circle refund tx ${refundTxId} succeeded but Supabase update failed for task ${id}`,
        updateError
      );
      return NextResponse.json(
        { error: "Refund sent but task status update failed. Contact support.", refundTxId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      refundTxId,
      message: task.escrow_funding_state === "funded"
        ? "Task cancelled and escrow refunded."
        : "Task cancelled. No escrow was held.",
    });
  } catch (err) {
    console.error("[cancel] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
