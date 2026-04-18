import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { PROGRAM_ID } from "../../../lib/solana";

export async function POST(req: NextRequest) {
  try {
    const { walletAddress } = await req.json();
    if (!walletAddress) {
      return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
    }

    const authority = new PublicKey(walletAddress);
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), authority.toBytes()],
      PROGRAM_ID
    );

    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    const accountInfo = await connection.getAccountInfo(agentPDA);

    return NextResponse.json({
      success: true,
      agentPDA: agentPDA.toString(),
      alreadyRegistered: !!accountInfo,
      message: accountInfo
        ? "Agent already registered on-chain"
        : "Ready to register — call registerAgent from frontend",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
