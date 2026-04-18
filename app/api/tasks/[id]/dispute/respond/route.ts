import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAuthenticatedAddress } from "@/lib/auth";
import { getClientIp } from "@/lib/request-meta";
import { logAuditEvent } from "@/lib/audit-log";

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

    const { response } = await req.json() as { response?: string };
    if (!response?.trim()) {
      return NextResponse.json({ error: "Response is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    // Find the open dispute for this task
    const { data: dispute, error: disputeError } = await supabase
      .from("disputes")
      .select("id, agent_address, status")
      .eq("task_id", id)
      .eq("status", "open")
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: "No open dispute found for this task" }, { status: 404 });
    }

    // Find agent owned by this wallet
    const { data: agent } = await supabase
      .from("agents")
      .select("wallet_address")
      .eq("operator_address", callerAddress)
      .single();

    const agentWallet = agent?.wallet_address?.toLowerCase();
    if (!agentWallet || agentWallet !== dispute.agent_address.toLowerCase()) {
      return NextResponse.json({ error: "Only the assigned agent can respond to this dispute" }, { status: 403 });
    }

    const { error: updateError } = await supabase
      .from("disputes")
      .update({ agent_response: response.trim() })
      .eq("id", dispute.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to save response" }, { status: 500 });
    }

    logAuditEvent({
      endpoint: "tasks/dispute/respond",
      action: "dispute_response",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logAuditEvent({ endpoint: "tasks/dispute/respond", action: "dispute_response", ip, status: "error", message: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
