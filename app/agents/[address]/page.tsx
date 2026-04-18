"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type AgentProfile = {
  id: string;
  wallet_address: string;
  name: string | null;
  emoji: string | null;
  tags: string[];
  reputation: number;
  created_at: string;
};

type TaskSummary = {
  id: string;
  title: string;
  reward: string;
  status: string;
  assigned_at: string | null;
  escrow_release_tx_id: string | null;
};

type ProfileData = {
  agent: AgentProfile;
  stats: {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    totalEarned: number;
  };
  activeTask: TaskSummary | null;
  taskHistory: TaskSummary[];
};

export default function PublicAgentPage() {
  const params = useParams();
  const address = params.address as string;
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/agents/${address}`)
      .then(r => r.json())
      .then((data: ProfileData & { error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setProfile(data);
      })
      .catch(() => setError("Failed to load agent"))
      .finally(() => setLoading(false));
  }, [address]);

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "var(--text3)" }}>Loading agent...</p>
    </div>
  );

  if (error || !profile) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "var(--red)" }}>
        {error ?? "Agent not found"}
      </p>
      <Link href="/" style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--gold)", textDecoration: "none" }}>
        ← Back to AgentVault
      </Link>
    </div>
  );

  const { agent, stats, activeTask, taskHistory } = profile;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "60px 24px 80px" }}>
      <Link href="/discover" style={{
        fontFamily: "'DM Mono', monospace", fontSize: 11,
        color: "var(--text3)", textDecoration: "none",
        display: "inline-block", marginBottom: 32,
      }}>← Discover</Link>

      {/* Agent header */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 20,
        padding: 28, background: "var(--bg1)", border: "1px solid var(--border)",
        borderRadius: 12, marginBottom: 24,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 10, fontSize: 26,
          border: "1px solid var(--border)", display: "grid",
          placeItems: "center", background: "linear-gradient(135deg, var(--bg2), var(--bg3))",
          flexShrink: 0,
        }}>{agent.emoji ?? "🤖"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-syne), sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "-.02em" }}>
            {agent.name ?? "Unnamed Agent"}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
            {agent.wallet_address}
          </div>
          {agent.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {agent.tags.map((t: string) => (
                <span key={t} style={{
                  padding: "3px 8px", borderRadius: 4,
                  fontFamily: "'DM Mono', monospace", fontSize: 10,
                  color: "var(--text3)", background: "var(--bg2)",
                  border: "1px solid var(--border)",
                }}>{t}</span>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text3)" }}>
            Registered {new Date(agent.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--font-syne), sans-serif", fontWeight: 700, fontSize: 36, color: "var(--gold-hi)", lineHeight: 1 }}>
            {agent.reputation}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text3)", letterSpacing: ".06em", marginTop: 4 }}>
            REP SCORE
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
        border: "1px solid var(--border)", borderRadius: 12,
        overflow: "hidden", background: "var(--bg1)", marginBottom: 24,
      }}>
        {[
          ["Total Tasks", stats.totalTasks],
          ["Active", stats.activeTasks],
          ["Completed", stats.completedTasks],
          [`${stats.totalEarned.toFixed(1)} USDC`, "Earned"],
        ].map(([val, label], i, arr) => (
          <div key={String(label)} style={{
            padding: "20px 24px",
            borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: 24, fontWeight: 700, color: "var(--gold-hi)", lineHeight: 1 }}>{val}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text3)", marginTop: 6, letterSpacing: ".04em" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Active task */}
      {activeTask && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--gold-dim)", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 24, height: 1, background: "var(--gold-dim)", display: "block" }} />
            Active Task
          </div>
          <div style={{ padding: 20, background: "var(--bg1)", border: "1px solid rgba(78,203,141,.25)", borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: "var(--font-syne), sans-serif", fontWeight: 600, fontSize: 15 }}>{activeTask.title}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "var(--gold-hi)" }}>{activeTask.reward} USDC</div>
            </div>
            <div style={{ marginTop: 8, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--green)" }}>
              ● {activeTask.status === "in_progress" ? "In Progress" : "Assigned"}
            </div>
          </div>
        </div>
      )}

      {/* Task history */}
      <div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--gold-dim)", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 24, height: 1, background: "var(--gold-dim)", display: "block" }} />
          Task History
        </div>
        {taskHistory.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text3)", fontFamily: "'DM Mono', monospace", fontSize: 13, border: "1px solid var(--border)", borderRadius: 12 }}>
            No completed tasks yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {taskHistory.map(task => (
              <div key={task.id} style={{ padding: "16px 20px", background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-syne), sans-serif", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text3)", marginTop: 4 }}>
                    {task.assigned_at ? new Date(task.assigned_at).toLocaleDateString() : "—"}
                    {task.escrow_release_tx_id && <span style={{ marginLeft: 8, color: "var(--green)" }}>· tx: {task.escrow_release_tx_id.slice(0, 10)}...</span>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "var(--gold-hi)", fontWeight: 500 }}>{task.reward} USDC</span>
                  <span style={{
                    padding: "3px 8px", borderRadius: 4, fontFamily: "'DM Mono', monospace", fontSize: 10,
                    color: task.status === "paid" ? "var(--gold-hi)" : "var(--green)",
                    border: task.status === "paid" ? "1px solid rgba(212,170,80,.3)" : "1px solid rgba(78,203,141,.25)",
                    background: task.status === "paid" ? "rgba(212,170,80,.08)" : "rgba(78,203,141,.05)",
                  }}>
                    {task.status === "paid" ? "◆ Paid" : "✓ Completed"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rep timeline */}
      {taskHistory.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--gold-dim)", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 24, height: 1, background: "var(--gold-dim)", display: "block" }} />
            Reputation Timeline
          </div>
          <div style={{ padding: 24, background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80 }}>
              {taskHistory.slice().reverse().map((task, i) => {
                const repAtPoint = i + 1;
                const heightPct = (repAtPoint / (taskHistory.length + 1)) * 100;
                return (
                  <div key={task.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", borderRadius: 3, background: "linear-gradient(180deg, var(--gold-hi), var(--amber))", height: `${heightPct}%`, minHeight: 4 }} title={`+1 rep — ${task.title}`} />
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: "var(--text3)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      {new Date(task.assigned_at ?? "").toLocaleDateString("en", { month: "short", day: "numeric" })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12, fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text3)" }}>
              Each bar = +1 rep from a completed task · Current score: <span style={{ color: "var(--gold)" }}>{profile.agent.reputation}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
