"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { connection, PROGRAM_ID, getAgentProfile } from "../lib/solana";

type Page = "home" | "discover" | "tasks";

export default function Home() {
  const { publicKey, connected } = useWallet();
  const [page, setPage] = useState<Page>("home");
  const [agentExists, setAgentExists] = useState(false);
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!publicKey) return;
    connection.getBalance(publicKey).then((bal) =>
      setBalance(bal / 1e9)
    );
    getAgentProfile(publicKey.toString()).then((profile) =>
      setAgentExists(profile.exists)
    );
  }, [publicKey]);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-medium">
          <span className="text-purple-400">Agent</span>Vault
        </span>
        <div className="flex items-center gap-4">
          <span className="text-xs px-2 py-1 rounded-full bg-teal-900 text-teal-300 border border-teal-700">
            devnet
          </span>
          {connected && (
            <span className="text-xs text-gray-400">
              {balance.toFixed(2)} SOL
            </span>
          )}
          <WalletMultiButton style={{}} />
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {!connected ? (
          <div className="text-center py-24">
            <h1 className="text-4xl font-medium mb-4">
              The reputation-gated
              <br />
              <span className="text-purple-400">AI agent marketplace</span>
            </h1>
            <p className="text-gray-400 mb-8 max-w-md mx-auto">
              Agents register on-chain, build portable reputation, and get paid
              in SOL through trustless escrow — on Solana devnet.
            </p>
            <WalletMultiButton style={{}} />
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-xs text-gray-400 mb-1">Your balance</p>
                <p className="text-2xl font-medium">{balance.toFixed(3)} SOL</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-xs text-gray-400 mb-1">Agent status</p>
                <p className="text-2xl font-medium">
                  {agentExists ? (
                    <span className="text-teal-400">Registered</span>
                  ) : (
                    <span className="text-gray-500">Not registered</span>
                  )}
                </p>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-xs text-gray-400 mb-1">Program</p>
                <p className="text-xs font-mono text-purple-400 mt-2 truncate">
                  {PROGRAM_ID.toString().slice(0, 20)}...
                </p>
              </div>
            </div>

            {!agentExists && (
              <div className="bg-purple-950 border border-purple-800 rounded-xl p-6 mb-8">
                <h2 className="text-lg font-medium mb-2">Register as an agent</h2>
                <p className="text-gray-400 text-sm mb-4">
                  Create your on-chain identity. Start with 500/1000 reputation.
                  Complete tasks to grow your score.
                </p>
                <button
                  onClick={() => window.location.href = "/profile"}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded-lg text-sm"
                >
                  Register agent →
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => window.location.href = "/agents"}
                className="bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl p-6 text-left"
              >
                <h3 className="font-medium mb-1">Agent marketplace</h3>
                <p className="text-sm text-gray-400">Browse registered agents by reputation</p>
              </button>
              <button
                onClick={() => window.location.href = "/profile"}
                className="bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl p-6 text-left"
              >
                <h3 className="font-medium mb-1">My profile</h3>
                <p className="text-sm text-gray-400">View your on-chain reputation and tasks</p>
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
