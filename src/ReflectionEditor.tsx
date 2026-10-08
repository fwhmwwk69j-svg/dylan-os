import { useEffect, useState, type FormEvent } from "react";
import type { State } from "./data";
import { uid, day } from "./data";
import { weekStart, saveReflection } from "./planning";
import { offsetDate } from "./personal";
function Editor({
  data,
  start,
  onChange,
  onDelete,
}: {
  data: State;
  start: string;
  onChange: (next: State, reason: string) => Promise<boolean>;
  onDelete: (next: State, label: string) => Promise<void>;
}) {
  const record = data.weeklyReflections.find((r) => r.weekStart === start);
  const [reflection, setReflection] = useState(record?.reflection ?? "");
  const [priorities, setPriorities] = useState(
    record?.priorities ?? ["", "", ""],
  );
  useEffect(() => {
    setReflection(record?.reflection ?? "");
    setPriorities(record?.priorities ?? ["", "", ""]);
  }, [record?.id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const next = saveReflection(data, {
        ...record,
        id: record?.id ?? uid(),
        weekStart: start,
        reflection: String(f.get("reflection") ?? ""),
        priorities: [0, 1, 2].map((i) =>
          String(f.get("priority" + i) ?? "").trim(),
        ),
        savedAt: new Date().toISOString(),
      });
      setMessage(
        (await onChange(next, "Before saving weekly reflection"))
          ? "Weekly reflection saved."
          : "Not saved. Resolve the workspace warning first.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <p className="muted">
        Reflect on {start}–{offsetDate(start, 6)}. These priorities appear on
        Today and the planner during {offsetDate(start, 7)}–
        {offsetDate(start, 13)}.
      </p>
      <label>
        Weekly reflection
        <textarea
          aria-label="Weekly reflection"
          name="reflection"
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={5}
          placeholder="What worked? What should change next week?"
        />
      </label>
      <div className="form-grid">
        {[0, 1, 2].map((i) => (
          <label key={i}>
            Next-week priority {i + 1}
            <input
              name={"priority" + i}
              required
              maxLength={250}
              value={priorities[i]}
              onChange={(e) =>
                setPriorities(
                  priorities.map((p, index) =>
                    index === i ? e.target.value : p,
                  ),
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="heading-actions">
        <button className="primary" disabled={busy}>
          Save weekly reflection
        </button>
        {record && (
          <button
            className="danger text-button"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDelete(
                {
                  ...data,
                  weeklyReflections: data.weeklyReflections.filter(
                    (r) => r.id !== record.id,
                  ),
                },
                "weekly reflection",
              );
              setBusy(false);
            }}
          >
            Delete weekly reflection
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export default function ReflectionEditor(props: {
  data: State;
  onChange: (next: State, reason: string) => Promise<boolean>;
  onDelete: (next: State, label: string) => Promise<void>;
}) {
  const [start, setStart] = useState(weekStart());
  return (
    <section className="card planner-editor">
      <div className="card-heading">
        <h2>Saved weekly reflection</h2>
      </div>
      <label>
        Review week (Monday)
        <input
          type="date"
          value={start}
          max={day()}
          onChange={(e) => {
            if (e.target.value) setStart(weekStart(e.target.value));
          }}
        />
      </label>
      <Editor key={start} {...props} start={start} />
      <div className="reflection-history">
        <h3>Previous reflections</h3>
        {[...props.data.weeklyReflections]
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
          .map((r) => (
            <button
              key={r.id}
              className="secondary"
              onClick={() => setStart(r.weekStart)}
            >
              Review {r.weekStart}
            </button>
          ))}
        {!props.data.weeklyReflections.length && (
          <p className="empty">Your saved reflections will appear here.</p>
        )}
      </div>
    </section>
  );
}
