import { NextResponse } from "next/server";
import { listTasks } from "@/lib/task-repo";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}
