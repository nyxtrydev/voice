import { useStore } from "../store";
import type { ViewName } from "../types";
import { Chevron, PersonSelectIcon, PlusIcon, RefreshIcon } from "../lib/icons";

const VIEW_TITLES: Record<ViewName, string> = {
  dashboard: "Agent Overview",
  agents: "Agents",
  bookings: "Booking Table",
  calls: "Call History",
  prompts: "Prompt Editor"
};

export function Topbar({ onNewAgent }: { onNewAgent: () => void }) {
  const { user, view, agents, selectedAgentId, selectAgent, refresh } = useStore();

  const email = user?.email || "";
  const org = email.split("@")[1]?.split(".")[0] || email;
  const orgLabel = org ? org.charAt(0).toUpperCase() + org.slice(1) : "Loading…";

  return (
    <header className="topbar">
      <div className="topbar-identity">
        <p className="topbar-org">{orgLabel}</p>
        <h1 className="topbar-title">{VIEW_TITLES[view]}</h1>
      </div>
      <div className="topbar-controls">
        <div className="agent-picker-wrap">
          <label className="sr-only" htmlFor="agent-select">
            Select agent
          </label>
          <div className="select-wrapper">
            <PersonSelectIcon />
            <select
              id="agent-select"
              value={selectedAgentId ?? ""}
              onChange={e => void selectAgent(e.target.value)}
            >
              {agents.length === 0 ? (
                <option value="">No agents</option>
              ) : (
                agents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))
              )}
            </select>
            <Chevron />
          </div>
        </div>
        <button
          className="icon-btn"
          type="button"
          title="Refresh data"
          aria-label="Refresh data"
          onClick={() => void refresh()}
        >
          <RefreshIcon />
        </button>
        <button className="primary-btn" type="button" onClick={onNewAgent}>
          <PlusIcon />
          New agent
        </button>
      </div>
    </header>
  );
}
