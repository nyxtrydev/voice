import { useStore } from "../store";
import type { ViewName } from "../types";
import {
  AgentsIcon,
  BookingsIcon,
  BrandIcon,
  CallsIcon,
  DashboardIcon,
  LogoutIcon,
  PromptsIcon
} from "../lib/icons";

const NAV: { view: ViewName; label: string; Icon: () => JSX.Element }[] = [
  { view: "dashboard", label: "Dashboard", Icon: DashboardIcon },
  { view: "agents", label: "Agents", Icon: AgentsIcon },
  { view: "bookings", label: "Bookings", Icon: BookingsIcon },
  { view: "calls", label: "Calls", Icon: CallsIcon },
  { view: "prompts", label: "Prompts", Icon: PromptsIcon }
];

const PLAN_LIMITS: Record<string, number> = { starter: 100, growth: 500, pro: 999999 };
const PLAN_NAMES: Record<string, string> = { starter: "Starter Plan", growth: "Growth Plan", pro: "Pro Plan" };

export function Sidebar() {
  const { user, view, setView, logout, analytics } = useStore();
  const email = user?.email || "";

  const plan = user?.plan || "starter";
  const limit = PLAN_LIMITS[plan] ?? 100;
  const used = analytics?.calls?.calls_month ?? 0;
  const pct = limit >= 999999 ? 5 : Math.min(100, Math.round((used / limit) * 100));
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const renews = `Renews ${nextMonth.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-brand">
        <div className="brand-icon" aria-hidden="true">
          <BrandIcon />
        </div>
        <div className="brand-text">
          <span className="brand-name">VoiceAgentOS</span>
          <span className="brand-sub">{email || "Loading…"}</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {NAV.map(({ view: v, label, Icon }) => (
          <button
            key={v}
            className={"nav-item" + (view === v ? " active" : "")}
            onClick={() => setView(v)}
            type="button"
          >
            <span className="nav-icon" aria-hidden="true">
              <Icon />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="plan-card">
        <div className="plan-card-header">
          <span className="plan-label">{PLAN_NAMES[plan] || "Starter Plan"}</span>
          <span className="plan-badge">Active</span>
        </div>
        <div className="plan-usage">
          <span className="plan-count">
            {used} <em>/ {limit >= 999999 ? "∞" : limit}</em>
          </span>
          <span className="plan-unit">calls used</span>
        </div>
        <div
          className="plan-meter"
          role="progressbar"
          aria-label="Plan usage"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="plan-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="plan-renews">{renews}</span>
      </div>

      <button
        className="logout-btn"
        type="button"
        onClick={() => {
          if (confirm("Sign out?")) logout();
        }}
      >
        <LogoutIcon />
        Sign out
      </button>
    </aside>
  );
}
