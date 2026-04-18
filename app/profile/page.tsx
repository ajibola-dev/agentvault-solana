"use client";
import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PROGRAM_ID } from "../../lib/solana";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export default function ProfilePage() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [agentExists, setAgentExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!publicKey) return;
    connection.getBalance(publicKey).then((b) => setBalance(b / 1e9));
    checkAgent();
  }, [publicKey]);

  async function checkAgent() {
    if (!publicKey) return;
    const [agentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), publicKey.toBytes()],
      PROGRAM_ID
    );
    const info = await connection.getAccountInfo(agentPDA);
    setAgentExists(!!info);
    return agentPDA;
  }

  async function handleRegister() {
    if (!publicKey) return;
    setLoading(true);
    setStatus("Preparing transaction...");
    try {
      const [agentPDA, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), publicKey.toBytes()],
        PROGRAM_ID
      );
      const info = await connection.getAccountInfo(agentPDA);
      if (info) {
        setStatus("Already registered on-chain!");
        setAgentExists(true);
        setLoading(false);
        return;
      }
      const discriminator = Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]);
      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: agentPDA, isSigner: false, isWritable: true },
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: discriminator,
      });
      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      setStatus("Waiting for Phantom approval...");
      const sig = await sendTransaction(tx, connection);
      setStatus("Confirming on-chain...");
      await connection.confirmTransaction(sig, "confirmed");
      setStatus("Registered! Tx: " + sig.slice(0, 20) + "...");
      setAgentExists(true);
    } catch (e: any) {
      setStatus("Error: " + (e.message || "check console"));
      console.error(e);
    }
    setLoading(false);
  }

  if (!connected) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Connect wallet to view profile</p>
          <WalletMultiButton style={{}} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <a href="/" className="text-lg font-medium">
          <span className="text-purple-400">Agent</span>Vault
        </a>
        <WalletMultiButton style={{}} />
      </nav>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-medium mb-8">My profile</h1>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-purple-900 flex items-center justify-center text-purple-300 text-sm font-medium">
              {publicKey?.toString().slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-mono text-sm">{publicKey?.toString().slice(0, 24)}...</p>
              <p className="text-xs text-gray-400 mt-1">{balance.toFixed(3)} SOL</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Agent status</p>
              {agentExists ? (
                <p className="font-medium text-teal-400">Registered on-chain</p>
              ) : (
                <p className="font-medium text-gray-500">Not registered</p>
              )}
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Network</p>
              <p className="font-medium text-teal-400">Solana devnet</p>
            </div>
          </div>
          {!agentExists ? (
            <button onClick={handleRegister} disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-3 rounded-lg font-medium">
              {loading ? "Processing..." : "Register as agent"}
            </button>
          ) : (
            <div className="bg-teal-950 border border-teal-800 rounded-lg p-4 text-center">
              <p className="text-teal-400 text-sm">Agent identity live on Solana devnet</p>
            </div>
          )}
          {status && <p className="text-xs text-gray-400 mt-3 text-center">{status}</p>}
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="font-medium mb-4">Program info</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Program ID</span>
              <span className="font-mono text-purple-400 text-xs">{PROGRAM_ID.toString().slice(0,20)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Explorer</span>
              <a href={"https://explorer.solana.com/address/" + PROGRAM_ID.toString() + "?cluster=devnet"}
                target="_blank" className="text-purple-400 text-xs hover:underline">
                View on Solana Explorer
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
