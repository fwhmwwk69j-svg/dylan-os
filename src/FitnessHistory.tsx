import type { State } from "./data";
export default function FitnessHistory({
  data,
  onEdit,
  onDelete,
}: {
  data: State;
  onEdit: (kind: "weight" | "nutrition", date: string) => void;
  onDelete: (kind: "weights" | "nutrition", date: string) => void;
}) {
  return (
    <div className="two-grid">
      <section className="card">
        <div className="card-heading">
          <h2>Weight history</h2>
        </div>
        {[...data.weights]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((w) => (
            <div className="snapshot-row" key={w.date}>
              <div className="row-grow">
                <strong>{w.value} lb</strong>
                <p className="row-meta">{w.date}</p>
              </div>
              <button
                className="secondary"
                aria-label={`Edit weight ${w.date}`}
                onClick={() => onEdit("weight", w.date)}
              >
                Edit
              </button>
              <button
                className="danger text-button"
                aria-label={`Delete weight ${w.date}`}
                onClick={() => onDelete("weights", w.date)}
              >
                Delete
              </button>
            </div>
          ))}
        {!data.weights.length && (
          <p className="empty">No weight entries yet.</p>
        )}
      </section>
      <section className="card">
        <div className="card-heading">
          <h2>Nutrition & steps history</h2>
        </div>
        {[...data.nutrition]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((n) => (
            <div className="snapshot-row" key={n.date}>
              <div className="row-grow">
                <strong>{n.date}</strong>
                <p className="row-meta">
                  {n.calories} kcal · {n.protein} g protein ·{" "}
                  {n.steps.toLocaleString()} steps
                </p>
              </div>
              <button
                className="secondary"
                aria-label={`Edit nutrition ${n.date}`}
                onClick={() => onEdit("nutrition", n.date)}
              >
                Edit
              </button>
              <button
                className="danger text-button"
                aria-label={`Delete nutrition ${n.date}`}
                onClick={() => onDelete("nutrition", n.date)}
              >
                Delete
              </button>
            </div>
          ))}
        {!data.nutrition.length && (
          <p className="empty">No nutrition or step entries yet.</p>
        )}
      </section>
    </div>
  );
}
