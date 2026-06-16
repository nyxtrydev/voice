import { useStore } from "../store";
import { eventLabel, fmtDuration, fmtTime } from "../lib/format";
import {
  ArrowRight,
  MetricBookingsIcon,
  MetricCallsIcon,
  MetricClockIcon,
  MetricStarIcon,
  PlusIcon,
  ResumeTriangle,
  StopSquare,
  TargetEmptyIcon
} from "../lib/icons";

export function DashboardView({ active, onNewAgent }: { active: boolean; onNewAgent: () => void }) {
  const {
    selectedAgent: agent,
    analytics,
    events,
    calls,
    config,
    sseConnected,
    setView,
    stopAgent,
    resumeAgent,
    loadCallDetail
  } = useStore();

  const viewClass = "view" + (active ? " active" : "");

  if (!agent) {
    return (
      <section className={viewClass} aria-labelledby="view-title">
        <div className="empty-state">
          <div className="empty-icon">
            <TargetEmptyIcon />
          </div>
          <h2>No agents yet</h2>
          <p>Create your first voice agent to see live metrics, calls, and bookings here.</p>
          <button className="primary-btn" type="button" onClick={onNewAgent}>
            <PlusIcon />
            Create first agent
          </button>
        </div>
      </section>
    );
  }

  const a = analytics;
  const isLive = agent.status === "live";
  const isPaused = agent.status === "paused";
  const isDraft = agent.status === "draft";

  const phoneDisplay =
    agent.twilioPhoneNumber || (isDraft && config.twilioPhone ? config.twilioPhone : null) || (isDraft ? "Not provisioned" : "—");

  const liveState = isLive
    ? "Ready for inbound calls"
    : isPaused
      ? "Paused — resume to take calls"
      : isDraft
        ? "Draft — provision to go live"
        : agent.status;

  const callsToday = a?.calls?.calls_today ?? 0;
  const callsWeek = a?.calls?.calls_week ?? 0;
  const avgDur = a?.calls?.avg_duration_seconds ?? 0;
  const avgSent = a?.calls?.avg_sentiment_score ?? 0;
  const bookTotal = a?.bookings?.total ?? 0;
  const bookConf = a?.bookings?.confirmed ?? 0;

  const pos = a?.calls?.positive ?? 0;
  const neu = a?.calls?.neutral ?? 0;
  const neg = a?.calls?.negative ?? 0;
  const total = Math.max(pos + neu + neg, 1);
  const posPct = Math.round((pos / total) * 100);
  const neuPct = Math.round((neu / total) * 100);
  const negPct = Math.max(0, 100 - posPct - neuPct);
  const hasSentiment = pos + neu + neg > 0;

  const donutBg = hasSentiment
    ? `conic-gradient(var(--apple-green) 0 ${posPct}%, var(--apple-orange) ${posPct}% ${posPct + neuPct}%, var(--apple-red) ${posPct + neuPct}% 100%)`
    : "var(--fill-2)";

  const recentCalls = calls.slice(0, 10);

  return (
    <section className={viewClass} aria-labelledby="view-title">
      <div>
        <div className="live-strip">
          <div className="live-strip-left">
            <span className={"live-dot" + (isLive ? " active" : "")} aria-hidden="true" />
            <strong>{agent.name}</strong>
            <span className="live-phone">{phoneDisplay}</span>
          </div>
          <div className="live-strip-right">
            <span className="live-state-label">{liveState}</span>
            {sseConnected && (
              <span className="status-pill">
                <span className="status-pill-dot" />
                Live
              </span>
            )}
            {isLive && (
              <button className="danger-btn" type="button" onClick={() => void stopAgent(agent.id)}>
                <StopSquare />
                Stop agent
              </button>
            )}
            {isPaused && (
              <button className="resume-btn" type="button" onClick={() => void resumeAgent(agent.id)}>
                <ResumeTriangle />
                Resume agent
              </button>
            )}
          </div>
        </div>

        <section className="metric-row" aria-label="Key metrics">
          <article className="metric-card">
            <div className="metric-icon metric-icon--blue" aria-hidden="true">
              <MetricCallsIcon />
            </div>
            <div className="metric-body">
              <span className="metric-label">Calls today</span>
              <strong className="metric-value">{callsToday}</strong>
              <span className="metric-delta">{callsWeek} this week</span>
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-icon metric-icon--green" aria-hidden="true">
              <MetricBookingsIcon />
            </div>
            <div className="metric-body">
              <span className="metric-label">Bookings</span>
              <strong className="metric-value">{bookTotal}</strong>
              <span className="metric-delta">{bookConf} confirmed</span>
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-icon metric-icon--orange" aria-hidden="true">
              <MetricClockIcon />
            </div>
            <div className="metric-body">
              <span className="metric-label">Avg duration</span>
              <strong className="metric-value">{avgDur ? fmtDuration(avgDur) : "—"}</strong>
              <span className="metric-delta">seconds per call</span>
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-icon metric-icon--purple" aria-hidden="true">
              <MetricStarIcon />
            </div>
            <div className="metric-body">
              <span className="metric-label">Sentiment</span>
              <strong className="metric-value">{avgSent || "—"}</strong>
              <span className="metric-delta positive">{avgSent ? "avg score" : "no data"}</span>
            </div>
          </article>
        </section>

        <div className="dash-grid">
          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">Realtime</p>
                <h2 className="card-title">Activity</h2>
              </div>
            </div>
            <div className="activity-list">
              {events.length ? (
                events.slice(0, 8).map((ev, i) => {
                  const t = new Date(ev.created_at);
                  const timeStr = t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                  const { title, detail } = eventLabel(ev);
                  return (
                    <div className="activity-item" key={ev.id ?? `${ev.event_type}-${i}`}>
                      <div className="activity-time">{timeStr}</div>
                      <div>
                        <strong>{title}</strong>
                        <span>{detail}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-inline">No activity yet.</div>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">Quality</p>
                <h2 className="card-title">Sentiment mix</h2>
              </div>
            </div>
            <div className="donut-wrap">
              <div
                className="donut"
                role="img"
                aria-label="Sentiment breakdown"
                style={{ background: donutBg }}
                data-score={hasSentiment ? `${avgSent}/100` : "—"}
              />
              <div className="donut-legend">
                {(
                  [
                    ["Positive", posPct, "var(--apple-green)"],
                    ["Neutral", neuPct, "var(--apple-orange)"],
                    ["Negative", negPct, "var(--apple-red)"]
                  ] as const
                ).map(([label, val, color]) => (
                  <div className="legend-row" key={label}>
                    <span className="legend-row-left">
                      <i className="swatch" style={{ background: color }} />
                      {label}
                    </span>
                    <strong>{val}%</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="card-eyebrow">Recent</p>
              <h2 className="card-title">Last calls</h2>
            </div>
            <button className="ghost-btn" type="button" onClick={() => setView("calls")}>
              View all <ArrowRight />
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Caller</th>
                  <th>Outcome</th>
                  <th>Sentiment</th>
                  <th>Duration</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.length ? (
                  recentCalls.map(c => (
                    <tr
                      key={c.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        void loadCallDetail(c.id);
                        setView("calls");
                      }}
                    >
                      <td>{c.callerName || c.callerPhone || "Unknown"}</td>
                      <td>{c.outcome}</td>
                      <td>
                        {c.sentiment ? (
                          <span className={`badge ${c.sentiment}`}>
                            {c.sentiment}
                            {c.sentimentScore ? ` · ${c.sentimentScore}` : ""}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{c.durationSeconds ? fmtDuration(c.durationSeconds) : "—"}</td>
                      <td>{fmtTime(c.startedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      No calls yet. Calls will appear here after they are processed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
