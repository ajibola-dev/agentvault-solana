import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { createPublicClient, http } from "viem";

export const runtime = "nodejs";

const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://arc-testnet.drpc.org"] } },
} as const;

const reputationAbi = [{
  name: "getReputation", type: "function", stateMutability: "view",
  inputs: [{ name: "agent", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

async function getReputationScore(address: string): Promise<number> {
  try {
    const client = createPublicClient({ chain: arcTestnet, transport: http() });
    const score = await client.readContract({
      address: REPUTATION_REGISTRY as `0x${string}`,
      abi: reputationAbi,
      functionName: "getReputation",
      args: [address as `0x${string}`],
    });
    return Number(score);
  } catch { return 1; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 1. Get agent record
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, wallet_address, name, emoji, tags, reputation, created_at, operator_address")
    .eq("operator_address", address)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ error: "No agent found for this wallet" }, { status: 404 });
  }

  // 2. Get onchain rep
  const onchainRep = await getReputationScore(agent.wallet_address);

  // 3. Get all tasks for this agent
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, description, reward, status, created_at, assigned_at, escrow_release_tx_id")
    .eq("agent_address", agent.wallet_address)
    .order("created_at", { ascending: false });

  const allTasks = tasks ?? [];

  // 4. Compute stats
  const activeTasks = allTasks.filter(t => ["assigned", "in_progress"].includes(t.status));
  const completedTasks = allTasks.filter(t => ["completed", "paid"].includes(t.status));
  const totalEarned = allTasks
    .filter(t => t.status === "paid")
    .reduce((sum, t) => sum + parseFloat(t.reward || "0"), 0);

  return NextResponse.json({
    agent: {
      ...agent,
      reputation: onchainRep,
    },
    stats: {
      totalTasks: allTasks.length,
      activeTasks: activeTasks.length,
      completedTasks: completedTasks.length,
      totalEarned,
    },
    activeTask: activeTasks[0] ?? null,
    taskHistory: completedTasks,
  });
}
