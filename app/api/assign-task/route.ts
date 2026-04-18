// @ts-check
import { NextResponse } from "next/server";
import { getAuthenticatedAddress, sameAddress } from "@/lib/auth";
import { assignTask, getTaskById } from "@/lib/task-repo";
import { getClientIp } from "@/lib/request-meta";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";

type AssignTaskRequest = {
  taskId?: string;
  agentId?: string;
  agentAddress?: string | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit({
    endpoint: "tasks/assign",
    key: `ip:${ip}`,
    max: 30,
    windowMs: 60_000,
  });

  if (!ipLimit.allowed) {
    logAuditEvent({
      endpoint: "tasks/assign",
      action: "assign_task",
      ip,
      status: "rate_limited",
      message: "Too many assignment requests",
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
        endpoint: "tasks/assign",
        action: "assign_task",
        ip,
        status: "unauthorized",
        message: "Missing auth session",
      });
      return NextResponse.json({ error: "Unauthorized: sign in with wallet first" }, { status: 401 });
    }
    const actorLimit = await checkRateLimit({
      endpoint: "tasks/assign",
      key: `actor:${callerAddress.toLowerCase()}`,
      max: 30,
      windowMs: 60_000,
    });
    if (!actorLimit.allowed) {
      logAuditEvent({
        endpoint: "tasks/assign",
        action: "assign_task",
        actorAddress: callerAddress,
        ip,
        status: "rate_limited",
        message: "Too many assignment requests for this wallet",
      });
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(actorLimit.retryAfterSeconds) } }
      );
    }

    const { taskId, agentId, agentAddress } = await req.json() as AssignTaskRequest;

    if (!taskId || !agentId) {
      logAuditEvent({
        endpoint: "tasks/assign",
        action: "assign_task",
        actorAddress: callerAddress,
        ip,
        status: "validation_error",
        message: "Missing taskId or agentId",
      });
      return NextResponse.json({ error: "Missing taskId or agentId" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      logAuditEvent({
        endpoint: "tasks/assign",
        action: "assign_task",
        actorAddress: callerAddress,
        ip,
        status: "not_found",
        resourceId: taskId,
        message: "Task not found",
      });
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!sameAddress(task.creatorAddress, callerAddress)) {
      logAuditEvent({
        endpoint: "tasks/assign",
        action: "assign_task",
        actorAddress: callerAddress,
        ip,
        status: "forbidden",
        resourceId: taskId,
        message: "Only task creator can assign",
      });
      return NextResponse.json({ error: "Forbidden: only task creator can assign" }, { status: 403 });
    }

    if (task.agentId) {
      logAuditEvent({
        endpoint: "tasks/assign",
        action: "assign_task",
        actorAddress: callerAddress,
        ip,
        status: "validation_error",
        resourceId: taskId,
        message: "Task already assigned",
      });
      return NextResponse.json({ error: "Task already assigned" }, { status: 400 });
    }
    
    // minRep enforcement
    const supabase = getSupabaseServerClient();
    const { data: agentData } = await supabase
      .from("agents")
      .select("reputation")
      .eq("wallet_address", agentAddress ?? "")
      .single();
    const agentRep = agentData?.reputation ?? 0;
    if (agentRep < (task.minRep ?? 0)) {
      return NextResponse.json({ error: `Rep score too low. Task requires ${task.minRep}, Agent: ${agentRep}` }, { status: 403 });
    }

    const updatedTask = await assignTask({
      id: taskId,
      agentId,
      agentAddress: agentAddress ?? null,
      assignedAt: new Date().toISOString(),
    });
    if (!updatedTask) {
      logAuditEvent({
        endpoint: "tasks/assign",
        action: "assign_task",
        actorAddress: callerAddress,
        ip,
        status: "not_found",
        resourceId: taskId,
        message: "Task not found",
      });
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    logAuditEvent({
      endpoint: "tasks/assign",
      action: "assign_task",
      actorAddress: callerAddress,
      ip,
      status: "success",
      resourceId: taskId,
      metadata: { agentId },
    });

    return NextResponse.json({ task: updatedTask });
  } catch (err: unknown) {
    logAuditEvent({
      endpoint: "tasks/assign",
      action: "assign_task",
      ip,
      status: "error",
      message: getErrorMessage(err),
    });
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

