"use client";
import { useWallet } from "@solana/wallet-adapter-react";

interface CancelTaskButtonProps {
  taskId: string;
  onCancelled?: () => void;
}

export default function CancelTaskButton({ taskId, onCancelled }: CancelTaskButtonProps) {
  const { publicKey } = useWallet();

  async function handleCancel() {
    if (!publicKey) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toString() }),
      });
      const data = await res.json();
      if (data.success && onCancelled) onCancelled();
    } catch (err) {
      console.error("Cancel failed:", err);
    }
  }

  return (
    <button
      onClick={handleCancel}
      className="text-xs px-3 py-1 rounded-lg border border-red-800 text-red-400 hover:bg-red-950"
    >
      Cancel task
    </button>
  );
}
