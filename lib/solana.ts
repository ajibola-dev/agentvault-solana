import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import idl from "../app/agentvault_solana.json";

export const PROGRAM_ID = new PublicKey("7gURzVbrmtzJ8QoC9sC584fw9nkyahuUdFDmPnnCD6dB");
export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

export function getProgram(wallet: any) {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}

export async function getAgentProfile(walletAddress: string) {
  const authority = new PublicKey(walletAddress);
  const [agentPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), authority.toBytes()],
    PROGRAM_ID
  );
  try {
    const accountInfo = await connection.getAccountInfo(agentPDA);
    return { address: agentPDA.toString(), exists: !!accountInfo };
  } catch {
    return { address: agentPDA.toString(), exists: false };
  }
}

export async function getTaskEscrow(clientAddress: string, agentAddress: string) {
  const client = new PublicKey(clientAddress);
  const agent = new PublicKey(agentAddress);
  const [taskPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("task"), client.toBytes(), agent.toBytes()],
    PROGRAM_ID
  );
  try {
    const accountInfo = await connection.getAccountInfo(taskPDA);
    return { address: taskPDA.toString(), exists: !!accountInfo };
  } catch {
    return { address: taskPDA.toString(), exists: false };
  }
}
