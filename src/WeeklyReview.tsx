import { weeklyReview } from "./personal";
import { type State } from "./data";
export default function WeeklyReview({
  data,
  onToday,
  onFitness,
}: {
  data: State;
  onToday: () => void;
  onFitness: () => void;
}) {
  const r = weeklyReview(data);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            LAST 7 DAYS · {r.start} → {r.end}
          </div>
          <h1>A moment to reflect.</h1>
          <p>Look back at the work, then make room for what’s next.</p>
        </div>
        <button className="secondary" onClick={onToday}>
          Back to Today
        </button>
      </div>
      <div className="stat-grid">
        <div className="stat">
          <span>Tasks completed</span>
          <strong>{r.tasksCompleted}</strong>
          <p>By completion date</p>
        </div>
        <div className="stat">
          <span>School work completed</span>
          <strong>{r.assignmentsCompleted}</strong>
          <p>Assignments and exams</p>
        </div>
        <div className="stat">
          <span>Workouts</span>
          <strong>{r.sessions}</strong>
          <p>Unique date + workout sessions</p>
        </div>
        <div className="stat">
          <span>Average daily steps</span>
          <strong>
            {r.stepAverage === null
              ? "—"
              : Math.round(r.stepAverage).toLocaleString()}
          </strong>
          <p>{r.stepDays} of 7 days logged · missing days excluded</p>
        </div>
      </div>
      {r.legacyCompletions > 0 && (
        <p className="tip">
          {r.legacyCompletions} older completed records have no completion date
          and are excluded from this week’s counts.
        </p>
      )}
      <div className="two-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Upcoming school workload</h2>
              <p>Next 7 days, with overdue work kept in view.</p>
            </div>
          </div>
          {r.workload.length ? (
            r.workload.map((a) => (
              <div className="important-date" key={a.id}>
                <div>
                  <strong>{a.name}</strong>
                  <p className="row-meta">
                    {data.courses.find((c) => c.id === a.courseId)?.name} ·{" "}
                    {a.type}
                  </p>
                </div>
                <span className={a.due < r.end ? "urgency overdue" : ""}>
                  {a.due < r.end ? "Overdue · " : ""}
                  {a.due}
                </span>
              </div>
            ))
          ) : (
            <p className="empty">No pending deadlines in the next week.</p>
          )}
        </section>
        <section className="card">
          <div className="card-heading">
            <h2>Weight trend</h2>
            <button className="subtle-link" onClick={onFitness}>
              View fitness
            </button>
          </div>
          <div className="big-number">
            {r.weightChange === null
              ? "—"
              : `${r.weightChange > 0 ? "+" : ""}${r.weightChange.toFixed(1)}`}
            <small>{r.weightChange === null ? "" : "lb"}</small>
          </div>
          <p className="muted">
            {r.weightEntries.length >= 2
              ? `${r.weightEntries[0].value} → ${r.weightEntries.at(-1)!.value} lb, first to last entry this week.`
              : "Log at least two weights this week to see a trend."}
          </p>
          <p className="row-meta">{r.weightEntries.length} of 7 days logged.</p>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Habit consistency</h2>
              <p>Daily check-ins across the last 7 days.</p>
            </div>
          </div>
          <div className="big-number">
            {r.habitPercent === null ? "—" : r.habitPercent}
            <small>{r.habitPercent === null ? "" : "%"}</small>
          </div>
          <p className="muted">
            {r.habitCompleted} of {r.habitPossible} possible check-ins. New
            habits count from their creation date.
          </p>
          {data.habits.map((h) => (
            <div className="important-date" key={h.name}>
              <span>{h.name}</span>
              <strong>
                {
                  new Set(
                    h.dates.filter(
                      (d) =>
                        d >= r.start &&
                        d <= r.end &&
                        (!h.createdOn || d >= h.createdOn),
                    ),
                  ).size
                }{" "}
                days
              </strong>
            </div>
          ))}
        </section>
        <section className="card">
          <div className="card-heading">
            <h2>Take into next week</h2>
          </div>
          <p className="muted">
            What worked? What felt too crowded? Pick one thing to repeat and one
            thing to simplify.
          </p>
          <p className="muted">
            Start with your overdue items, then plan around the{" "}
            {r.workload.filter((a) => a.due >= r.end).length} approaching school
            deadlines.
          </p>
          <button className="secondary" onClick={onToday}>
            Plan from Today
          </button>
        </section>
      </div>
    </>
  );
}
