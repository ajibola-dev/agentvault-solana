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

    const { reason } = await req.json() as { reason?: string };
    if (!reason?.trim()) {
      return NextResponse.json({ error: "Dispute reason is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status, creator_address, agent_address")
      .eq("id", id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.creator_address.toLowerCase() !== callerAddress.toLowerCase()) {
      return NextResponse.json({ error: "Only the task creator can raise a dispute" }, { status: 403 });
    }

    if (task.status !== "completed") {
      return NextResponse.json(
        { error: `Cannot dispute a task with status '${task.status}'. Only completed tasks can be disputed.` },
        { status: 400 }
      );
    }

    if (!task.agent_address) {
      return NextResponse.json({ error: "Task has no assigned agent" }, { status: 400 });
    }

    // Create dispute record
    const { data: dispute, error: disputeError } = await supabase
      .from("disputes")
      .insert({
        task_id: id,
        creator_address: task.creator_address,
        agent_address: task.agent_address,
        reason: reason.trim(),
        status: "open",
      })
      .select()
      .single();

    if (disputeError || !dispute) {
      return NextResponse.json({ error: "Failed to create dispute" }, { status: 500 });
    }

    // Flip task status to disputed
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: "disputed" })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update task status" }, { status: 500 });
    }

    logAuditEvent({
      endpoint: "tasks/dispute",
      action: "raise_dispute",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: id,
      metadata: { disputeId: dispute.id },
    });

    return NextResponse.json({ dispute });
  } catch (err) {
    logAuditEvent({ endpoint: "tasks/dispute", action: "raise_dispute", ip, status: "error", message: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
