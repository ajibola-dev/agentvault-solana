import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { createPublicClient, http } from "viem";

export const runtime = "nodejs";

const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const arcTestnet = {
  id: 5042002, name: "Arc Testnet",
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
      abi: reputationAbi, functionName: "getReputation",
      args: [address as `0x${string}`],
    });
    return Number(score);
  } catch { return 1; }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const supabase = getSupabaseServerClient();

  const { data: agent, error } = await supabase
    .from("agents")
    .select("id, wallet_address, name, emoji, tags, reputation, created_at")
    .eq("wallet_address", address)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const onchainRep = await getReputationScore(agent.wallet_address);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, reward, status, assigned_at, escrow_release_tx_id")
    .eq("agent_address", agent.wallet_address)
    .order("created_at", { ascending: false });

  const allTasks = tasks ?? [];
  const activeTasks = allTasks.filter(t => ["assigned", "in_progress"].includes(t.status));
  const completedTasks = allTasks.filter(t => ["completed", "paid"].includes(t.status));
  const totalEarned = allTasks
    .filter(t => t.status === "paid")
    .reduce((sum, t) => sum + parseFloat(t.reward || "0"), 0);

  return NextResponse.json({
    agent: { ...agent, reputation: onchainRep },
    stats: { totalTasks: allTasks.length, activeTasks: activeTasks.length, completedTasks: completedTasks.length, totalEarned },
    activeTask: activeTasks[0] ?? null,
    taskHistory: completedTasks,
  });
}
