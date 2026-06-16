import { useState } from "react";
import { useStore } from "../store";
import { fmtDuration, fmtTime } from "../lib/format";
import { SearchIcon } from "../lib/icons";
import type { Call, CallTurn } from "../types";

function CallDetail({ call }: { call: Call | null }) {
  if (!call) {
    return <div className="empty-inline">Select a call to view its transcript.</div>;
  }

  let turns: CallTurn[] = call.turns ?? [];
  if (turns.length === 0 && call.transcript) {
    turns = call.transcript
      .split("\n")
      .filter(l => l.trim())
      .map(line => {
        const isAgent = line.toLowerCase().startsWith("agent:");
        return { speaker: isAgent ? "agent" : "caller", text: line.replace(/^(agent:|caller:)\s*/i, "") };
      });
  }

  return (
    <>
      <div className="card-header">
        <div>
          <p className="card-eyebrow">{call.id.slice(0, 8)}…</p>
          <h2 className="card-title">{call.callerName || call.callerPhone || "Unknown caller"}</h2>
        </div>
        {call.sentiment && (
          <span className={`badge ${call.sentiment}`}>
            {call.sentiment}
            {call.sentimentScore ? ` · ${call.sentimentScore}` : ""}
          </span>
        )}
      </div>
      {call.summary && (
        <p style={{ fontSize: 14, color: "var(--label-2)", marginBottom: 16 }}>{call.summary}</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 12,
          padding: 14,
          background: "var(--fill-3)",
          borderRadius: "var(--r-lg)",
          marginBottom: 12
        }}
      >
        <div>
          <span className="agent-stat-label">Outcome</span>
          <span className="agent-stat-val" style={{ fontSize: 14, textTransform: "capitalize" }}>
            {call.outcome}
          </span>
        </div>
        <div>
          <span className="agent-stat-label">Duration</span>
          <span className="agent-stat-val" style={{ fontSize: 14 }}>
            {call.durationSeconds ? fmtDuration(call.durationSeconds) : "—"}
          </span>
        </div>
        <div>
          <span className="agent-stat-label">Started</span>
          <span className="agent-stat-val" style={{ fontSize: 14 }}>
            {fmtTime(call.startedAt)}
          </span>
        </div>
      </div>
      <div className="transcript">
        {turns.length ? (
          turns.map((t, i) => (
            <div className={`turn ${t.speaker}`} key={i}>
              <strong>{t.speaker === "caller" ? "Caller" : "Agent"}</strong>
              <p>{t.text}</p>
            </div>
          ))
        ) : (
          <div className="empty-inline">Transcript not available.</div>
        )}
      </div>
    </>
  );
}

export function CallsView({ active }: { active: boolean }) {
  const { calls, selectedCallId, loadCallDetail } = useStore();
  const [query, setQuery] = useState("");
  const viewClass = "view" + (active ? " active" : "");

  const q = query.trim().toLowerCase();
  const filtered = calls.filter(c => {
    if (!q) return true;
    const hay = `${c.callerName ?? ""} ${c.callerPhone ?? ""} ${c.outcome ?? ""} ${c.summary ?? ""} ${c.transcript ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

  const activeCall = calls.find(c => c.id === selectedCallId) ?? null;

  return (
    <section className={viewClass} aria-labelledby="view-title">
      <div className="view-header">
        <div>
          <p className="view-eyebrow">Transcripts</p>
          <h2 className="view-heading">Call history</h2>
        </div>
        <label className="search-field">
          <SearchIcon />
          <input type="search" placeholder="Search calls…" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="call-layout">
        <div className="card call-list-panel">
          <div>
            {filtered.length ? (
              filtered.map(c => (
                <button
                  key={c.id}
                  className={"call-item" + (c.id === selectedCallId ? " active" : "")}
                  type="button"
                  onClick={() => void loadCallDetail(c.id)}
                >
                  <span className="call-item-name">{c.callerName || c.callerPhone || "Unknown caller"}</span>
                  <span className="call-item-meta">
                    {c.outcome} · {fmtTime(c.startedAt)} · {c.durationSeconds ? fmtDuration(c.durationSeconds) : "—"}
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-inline">{q ? "No calls match your search." : "No calls yet."}</div>
            )}
          </div>
        </div>
        <article className="card call-detail">
          <CallDetail call={activeCall} />
        </article>
      </div>
    </section>
  );
}
