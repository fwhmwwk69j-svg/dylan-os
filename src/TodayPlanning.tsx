import type { State } from "./data";
import { day } from "./dates";
import { commitmentsOn, weekPriorities } from "./planning";
export default function TodayPlanning({
  data,
  onPlanner,
}: {
  data: State;
  onPlanner: () => void;
}) {
  const commitments = commitmentsOn(data, day()),
    priorities = weekPriorities(data);
  return (
    <section className="card today-planning">
      <div className="card-heading">
        <h2>Your week, today</h2>
        <button className="subtle-link" onClick={onPlanner}>
          Open weekly planner
        </button>
      </div>
      {commitments.map((c) => (
        <p key={c.id} className="important-date">
          <strong>{c.name}</strong>
          <span>
            {c.startTime}–{c.endTime} · {c.kind}
          </span>
        </p>
      ))}
      {!commitments.length && (
        <p className="row-meta">No recurring commitments scheduled today.</p>
      )}
      {priorities.length > 0 && (
        <>
          <h3>This week’s priorities</h3>
          <ol>
            {priorities.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
