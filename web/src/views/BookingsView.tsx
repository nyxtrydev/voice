import { useStore } from "../store";
import type { BookingStatus } from "../types";

const FILTERS: { key: "all" | BookingStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "pending", label: "Pending" },
  { key: "cancelled", label: "Cancelled" }
];

const STATUSES: BookingStatus[] = ["pending", "confirmed", "cancelled"];

export function BookingsView({ active }: { active: boolean }) {
  const { bookings, bookingFilter, setBookingFilter, updateBookingStatus } = useStore();
  const viewClass = "view" + (active ? " active" : "");

  const filtered = bookingFilter === "all" ? bookings : bookings.filter(b => b.status === bookingFilter);

  return (
    <section className={viewClass} aria-labelledby="view-title">
      <div className="view-header">
        <div>
          <p className="view-eyebrow">Operations</p>
          <h2 className="view-heading">Booking table</h2>
        </div>
        <div className="seg-control" role="group" aria-label="Booking filter">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={bookingFilter === f.key ? "active" : ""}
              type="button"
              onClick={() => setBookingFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Date</th>
                <th>Time</th>
                <th>Service</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? (
                filtered.map(b => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.phone || "—"}</td>
                    <td>{b.bookingDate || "—"}</td>
                    <td>{b.bookingTime || "—"}</td>
                    <td>{b.service}</td>
                    <td>
                      <select
                        aria-label={`Status for ${b.name}`}
                        value={b.status}
                        onChange={e => void updateBookingStatus(b.id, e.target.value as BookingStatus)}
                      >
                        {STATUSES.map(s => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="table-empty">
                    No bookings {bookingFilter !== "all" ? `with status "${bookingFilter}"` : "yet"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
