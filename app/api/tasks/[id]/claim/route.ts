import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAuthenticatedAddress } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit-log";
import { getClientIp } from "@/lib/request-meta";

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
      return NextResponse.json({ error: "Unauthorized: sign in with wallet first" }, { status: 401 });
    }

    const supabase = getSupabaseServerClient();

    // 1. Find the agent owned by this wallet
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, wallet_address, reputation")
      .eq("operator_address", callerAddress)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: "No registered agent found for this wallet. Register an agent first." },
        { status: 403 }
      );
    }

    // 2. Check agent doesn't already have an active task
    const { data: activeTask } = await supabase
      .from("tasks")
      .select("id")
      .eq("agent_address", agent.wallet_address)
      .in("status", ["assigned", "in_progress"])
      .maybeSingle();

    if (activeTask) {
      return NextResponse.json(
        { error: "You already have an active task. Complete it before claiming another." },
        { status: 400 }
      );
    }

    // 3. Fetch the task
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status, agent_id, min_rep, creator_address")
      .eq("id", id)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 4. Status check
    if (task.status !== "open" || task.agent_id) {
      return NextResponse.json({ error: "Task is no longer available" }, { status: 400 });
    }

    // 5. Rep check
    if (agent.reputation < (task.min_rep ?? 0)) {
      return NextResponse.json(
        { error: `Rep score too low. Task requires ${task.min_rep}, your agent has ${agent.reputation}.` },
        { status: 403 }
      );
    }

    // 6. Assign
    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "assigned",
        agent_id: agent.id,
        agent_address: agent.wallet_address,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "open") // race condition guard
      .select()
      .single();

    if (updateError || !updatedTask) {
      return NextResponse.json({ error: "Task was claimed by someone else or no longer available" }, { status: 409 });
    }

    logAuditEvent({
      endpoint: "tasks/claim",
      action: "claim_task",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: id,
      metadata: { agentId: agent.id },
    });

    return NextResponse.json({ task: updatedTask });
  } catch (err) {
    logAuditEvent({
      endpoint: "tasks/claim",
      action: "claim_task",
      ip,
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
