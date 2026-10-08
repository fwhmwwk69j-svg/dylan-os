import { useEffect, useState, type FormEvent } from "react";
import type { State, Commitment } from "./data";
import { day, uid } from "./data";
import {
  planDays,
  saveCommitment,
  skipCommitment,
  weekPriorities,
} from "./planning";
import { offsetDate, urgency, toggleHabit } from "./personal";
import { habitComplete, habitCount, habitPlan } from "./daily";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Change = (next: State, reason: string) => Promise<boolean>;
function CommitmentForm({
  data,
  record,
  onChange,
  onClose,
  onDelete,
}: {
  data: State;
  record: Commitment | null;
  onChange: Change;
  onClose: () => void;
  onDelete: (next: State, label: string) => Promise<void>;
}) {
  const [id] = useState(() => record?.id ?? uid());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const text = (key: string) => String(f.get(key) ?? "").trim();
    try {
      const next = saveCommitment(data, {
        ...record,
        id,
        name: text("name"),
        kind: text("kind") as Commitment["kind"],
        days: [...new Set(f.getAll("days").map(Number))],
        startTime: text("startTime"),
        endTime: text("endTime"),
        startsOn: text("startsOn"),
        endsOn: text("endsOn") || null,
        exceptions: [
          ...new Set(
            text("exceptions")
              .split(/[\s,]+/)
              .filter(Boolean),
          ),
        ],
      });
      if (await onChange(next, "Before saving weekly commitment")) onClose();
      else
        setError(
          "Not saved. Resolve the workspace warning before trying again.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card planner-editor">
      <div className="card-heading">
        <h2>{record ? "Edit weekly commitment" : "Add weekly commitment"}</h2>
      </div>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={save}>
        <label>
          Commitment name
          <input name="name" required defaultValue={record?.name} />
        </label>
        <label>
          Commitment type
          <select
            aria-label="Commitment type"
            name="kind"
            defaultValue={record?.kind ?? "Class"}
          >
            <option>Class</option>
            <option>Work</option>
            <option>Personal</option>
          </select>
        </label>
        <fieldset className="habit-schedule">
          <legend>Repeats on</legend>
          {WEEKDAYS.map((name, i) => (
            <label key={i}>
              <input
                type="checkbox"
                name="days"
                value={i}
                defaultChecked={
                  record?.days.includes(i) ?? i === new Date().getDay()
                }
              />
              {name}
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <label>
            Start time
            <input
              type="time"
              name="startTime"
              required
              defaultValue={record?.startTime ?? "09:00"}
            />
          </label>
          <label>
            End time
            <input
              type="time"
              name="endTime"
              required
              defaultValue={record?.endTime ?? "10:00"}
            />
          </label>
          <label>
            Starts on
            <input
              type="date"
              name="startsOn"
              required
              defaultValue={record?.startsOn ?? day()}
            />
          </label>
          <label>
            Ends on (optional)
            <input
              type="date"
              name="endsOn"
              defaultValue={record?.endsOn ?? ""}
            />
          </label>
        </div>
        <label>
          Exception dates
          <textarea
            aria-label="Exception dates"
            name="exceptions"
            placeholder="2026-12-25, 2027-01-01"
            defaultValue={record?.exceptions.join(", ") ?? ""}
          />
        </label>
        <p className="row-meta">
          Dates listed here are skipped. Use commas or new lines. Times use this
          device’s local timezone; split overnight shifts into two commitments.
        </p>
        <div className="heading-actions">
          <button className="primary" disabled={busy}>
            Save commitment
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel commitment
          </button>
          {record && (
            <button
              type="button"
              className="danger text-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onDelete(
                  {
                    ...data,
                    commitments: data.commitments.filter(
                      (c) => c.id !== record.id,
                    ),
                  },
                  "weekly commitment",
                );
                setBusy(false);
              }}
            >
              Delete commitment
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
export default function Planner({
  data,
  onChange,
  onDelete,
  onOpen,
  onToday,
}: {
  data: State;
  onChange: Change;
  onDelete: (next: State, label: string) => Promise<void>;
  onOpen: (kind: "task" | "school" | "workout", id: string) => void;
  onToday: () => void;
}) {
  const [start, setStart] = useState(day());
  const [editor, setEditor] = useState<Commitment | null | undefined>();
  useEffect(() => {
    if (editor && !data.commitments.some((c) => c.id === editor.id))
      setEditor(undefined);
  }, [data.commitments, editor]);
  const days = planDays(data, start);
  const overdueTasks = data.tasks.filter((t) => !t.completed && t.due < day());
  const overdueSchool = data.assignments.filter(
    (a) => !a.completed && a.due < day(),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE ROOM FOR THE WEEK</div>
          <h1>Seven-day planner</h1>
          <p>
            One view of your deadlines, routines, and recurring commitments.
          </p>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={onToday}>
            Back to Today
          </button>
          <button className="primary" onClick={() => setEditor(null)}>
            Add commitment
          </button>
        </div>
      </div>
      <div className="planner-toolbar">
        <button
          className="secondary"
          onClick={() => setStart(offsetDate(start, -7))}
        >
          Previous seven days
        </button>
        <label>
          Planning starts
          <input
            type="date"
            value={start}
            onChange={(e) => {
              if (e.target.value) setStart(e.target.value);
            }}
          />
        </label>
        <button className="secondary" onClick={() => setStart(day())}>
          Start today
        </button>
        <button
          className="secondary"
          onClick={() => setStart(offsetDate(start, 7))}
        >
          Next seven days
        </button>
      </div>
      {editor !== undefined && (
        <CommitmentForm
          key={editor?.id ?? "new"}
          data={data}
          record={editor}
          onChange={onChange}
          onClose={() => setEditor(undefined)}
          onDelete={onDelete}
        />
      )}
      {(overdueTasks.length > 0 || overdueSchool.length > 0) && (
        <section className="card planner-overdue">
          <div className="card-heading">
            <h2>Overdue work</h2>
          </div>
          {overdueTasks.map((t) => (
            <button
              key={t.id}
              className="text-button planner-item"
              onClick={() => onOpen("task", t.id)}
            >
              <span className="urgency overdue">Overdue</span> {t.name} ·{" "}
              {t.due}
            </button>
          ))}
          {overdueSchool.map((a) => (
            <button
              key={a.id}
              className="text-button planner-item"
              onClick={() => onOpen("school", a.id)}
            >
              <span className="urgency overdue">Overdue</span> {a.type}:{" "}
              {a.name} · {a.due}
            </button>
          ))}
        </section>
      )}
      <div className="planner-grid">
        {days.map((d) => (
          <section className="card planner-day" key={d.date}>
            <div className="card-heading">
              <div>
                <h2>
                  {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </h2>
                <p>{d.date === day() ? "Today" : d.date}</p>
              </div>
            </div>
            {weekPriorities(data, d.date).length > 0 && (
              <details>
                <summary>Weekly priorities</summary>
                <ol>
                  {weekPriorities(data, d.date).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ol>
              </details>
            )}
            {d.commitments.map((c) => (
              <div className="planner-item" key={c.id}>
                <button className="text-button" onClick={() => setEditor(c)}>
                  {c.startTime}–{c.endTime} · {c.name}
                </button>
                <p className="row-meta">{c.kind} · weekly</p>
                <button
                  className="subtle-link"
                  aria-label={`Skip ${c.name} on ${d.date}`}
                  onClick={() =>
                    onChange(
                      skipCommitment(data, c.id, d.date),
                      "Before skipping commitment occurrence",
                    )
                  }
                >
                  Skip this date
                </button>
              </div>
            ))}
            {d.tasks.map((t) => (
              <button
                className="text-button planner-item"
                key={t.id}
                onClick={() => onOpen("task", t.id)}
              >
                Task: {t.name}
                <p className="row-meta">
                  {t.completed ? "Completed" : t.priority + " priority"}
                  {!t.completed && urgency(t.due) && (
                    <span className={`urgency ${urgency(t.due)!.level}`}>
                      {urgency(t.due)!.label}
                    </span>
                  )}
                </p>
              </button>
            ))}
            {d.school.map((a) => (
              <button
                className="text-button planner-item"
                key={a.id}
                onClick={() => onOpen("school", a.id)}
              >
                {a.type}: {a.name}
                <p className="row-meta">
                  {data.courses.find((c) => c.id === a.courseId)?.name} ·{" "}
                  {a.completed ? "Completed" : "Due"}
                  {!a.completed && urgency(a.due) && (
                    <span className={`urgency ${urgency(a.due)!.level}`}>
                      {urgency(a.due)!.label}
                    </span>
                  )}
                </p>
              </button>
            ))}
            {d.workouts.map((w) => (
              <button
                className="text-button planner-item"
                key={w.id}
                onClick={() => onOpen("workout", w.id)}
              >
                Workout: {w.name}
                <p className="row-meta">
                  {w.exercise} · {w.sets ?? 1} × {w.weight} lb × {w.reps} ·{" "}
                  {w.completed ? "Completed" : "Planned"}
                </p>
              </button>
            ))}
            {d.habits.map(({ h, index }) => (
              <div className="planner-item" key={index}>
                <span>Habit: {h.name}</span>
                <p className="row-meta">
                  {habitCount(h, d.date)}/{habitPlan(h, d.date).target}
                  {habitComplete(h, d.date) ? " · Complete" : ""}
                </p>
                <button
                  className="subtle-link"
                  disabled={d.date > day()}
                  aria-label={`Check in ${h.name} on ${d.date}`}
                  onClick={() =>
                    onChange(
                      toggleHabit(data, index, d.date),
                      "Before updating planner habit history",
                    )
                  }
                >
                  {habitComplete(h, d.date)
                    ? "Reset completion"
                    : "Complete target"}
                </button>
              </div>
            ))}
            {d.dates.map((event, i) => (
              <p key={i} className="planner-item">
                Important date: {event.name}
              </p>
            ))}
            {!d.tasks.length &&
              !d.school.length &&
              !d.workouts.length &&
              !d.habits.length &&
              !d.commitments.length &&
              !d.dates.length && <p className="empty">No items planned.</p>}
          </section>
        ))}
      </div>
      <section className="card">
        <div className="card-heading">
          <h2>Recurring weekly commitments</h2>
        </div>
        {data.commitments.map((c) => (
          <div className="important-date" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <p className="row-meta">
                {c.kind} · {c.days.map((i) => WEEKDAYS[i]).join(", ")} ·{" "}
                {c.startTime}–{c.endTime} · {c.exceptions.length} skipped dates
              </p>
            </div>
            <button
              className="secondary"
              aria-label={`Edit commitment ${c.name}`}
              onClick={() => setEditor(c)}
            >
              Edit
            </button>
          </div>
        ))}
        {!data.commitments.length && (
          <p className="empty">
            Add classes, work shifts, or personal activities once; their weekly
            occurrences appear automatically.
          </p>
        )}
      </section>
    </>
  );
}
