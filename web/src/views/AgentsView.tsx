import { useStore } from "../store";
import { statusBadgeClass } from "../lib/format";
import { PersonEmptyIcon, PlayTriangle, PlusIcon, ResumeTriangle, StopSquare } from "../lib/icons";

export function AgentsView({ active, onNewAgent }: { active: boolean; onNewAgent: () => void }) {
  const { agents, selectAgent, setView, provisionAgent, stopAgent, resumeAgent } = useStore();
  const viewClass = "view" + (active ? " active" : "");

  return (
    <section className={viewClass} aria-labelledby="view-title">
      <div className="view-header">
        <div>
          <p className="view-eyebrow">Provisioning</p>
          <h2 className="view-heading">Agents</h2>
        </div>
        <button className="primary-btn" type="button" onClick={onNewAgent}>
          <PlusIcon />
          Create agent
        </button>
      </div>
      <div className="agent-grid">
        {agents.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: "1/-1" }}>
            <div className="empty-icon">
              <PersonEmptyIcon />
            </div>
            <h2>No agents yet</h2>
            <p>Create your first voice agent to start handling calls automatically.</p>
          </div>
        ) : (
          agents.map(a => (
            <article className="agent-card" key={a.id}>
              <div className="agent-card-header">
                <div>
                  <p className="agent-card-eyebrow">{a.persona}</p>
                  <h3>{a.name}</h3>
                </div>
                <span className={`badge ${statusBadgeClass(a.status)}`}>{a.status}</span>
              </div>
              <p className="agent-card-desc">{a.businessName}</p>
              <div className="agent-stats">
                <div>
                  <span className="agent-stat-label">Phone</span>
                  <span className="agent-stat-val" style={{ fontSize: 12 }}>
                    {a.twilioPhoneNumber || "—"}
                  </span>
                </div>
                <div>
                  <span className="agent-stat-label">Prompt v</span>
                  <span className="agent-stat-val">{a.promptVersion}</span>
                </div>
                <div>
                  <span className="agent-stat-label">Booking</span>
                  <span className="agent-stat-val" style={{ fontSize: 13 }}>
                    {a.bookingEnabled ? "Enabled" : "Off"}
                  </span>
                </div>
                <div>
                  <span className="agent-stat-label">Type</span>
                  <span className="agent-stat-val" style={{ fontSize: 13, textTransform: "capitalize" }}>
                    {a.businessType}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => {
                    void selectAgent(a.id);
                    setView("dashboard");
                  }}
                >
                  Dashboard
                </button>
                {a.status === "draft" && (
                  <button
                    className="primary-btn"
                    type="button"
                    style={{ flex: 1 }}
                    onClick={() => void provisionAgent(a.id)}
                  >
                    <PlayTriangle />
                    Provision &amp; go live
                  </button>
                )}
                {a.status === "live" && (
                  <button className="danger-btn" type="button" onClick={() => void stopAgent(a.id)}>
                    <StopSquare />
                    Stop agent
                  </button>
                )}
                {a.status === "paused" && (
                  <button className="resume-btn" type="button" onClick={() => void resumeAgent(a.id)}>
                    <ResumeTriangle />
                    Resume
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
