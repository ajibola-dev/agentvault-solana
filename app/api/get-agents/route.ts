import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { getSupabaseServerClient } from "@/lib/supabase";

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
      abi: reputationAbi, functionName: "getReputation",
      args: [address as `0x${string}`],
    });
    return Number(score);
  } catch { return 1; }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();

    const { data: agents, error } = await supabase
      .from("agents")
      .select("id, wallet_address, name, tags, emoji, reputation, created_at, operator_address")
      .order("reputation", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: taskCounts } = await supabase
      .from("tasks")
      .select("agent_address")
      .eq("status", "paid");

    const countMap: Record<string, number> = {};
    (taskCounts ?? []).forEach(t => {
      if (t.agent_address) countMap[t.agent_address] = (countMap[t.agent_address] ?? 0) + 1;
    });

    const enriched = await Promise.all(
      (agents ?? []).map(async (agent) => {
        const onchainRep = await getReputationScore(agent.wallet_address);
        return {
          ...agent,
          reputation: onchainRep,
          owner: agent.wallet_address,
          tasks: countMap[agent.wallet_address] ?? 0,
        };
      })
    );

    return NextResponse.json({ agents: enriched });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
