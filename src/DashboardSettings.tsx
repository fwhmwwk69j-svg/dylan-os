import type { State } from "./data";
import { dashboardPreferences, DASHBOARD_CARDS } from "./daily";
import { day } from "./dates";
export const CARD_LABELS: Record<string, string> = {
  priorities: "Daily priorities",
  overdue: "Overdue tasks",
  tasks: "Today’s tasks",
  assignments: "Upcoming assignments",
  exams: "Upcoming exams",
  workout: "Today’s workout",
  habits: "Daily habits",
  fitness: "Fitness progress",
  dates: "Important dates",
};
export default function DashboardSettings({
  data,
  onChange,
}: {
  data: State;
  onChange: (next: State) => void;
}) {
  const p = dashboardPreferences(data);
  function save(order = p.order, hidden = p.hidden, priorities = p.priorities) {
    onChange({
      ...data,
      preferences: {
        ...data.preferences,
        dashboard: { ...data.preferences?.dashboard, order, hidden },
        priorities: {
          ...data.preferences?.priorities,
          date: day(),
          ids: priorities,
        },
      },
    });
  }
  return (
    <>
      <h3 className="settings-subheading">Dashboard cards</h3>
      <p className="muted">
        Hide sections or move cards with the arrow buttons. Preferences are
        saved automatically.
      </p>
      {p.order.map((id, i) => (
        <div className="settings-row" key={id}>
          <label>
            <input
              type="checkbox"
              checked={!p.hidden.includes(id)}
              onChange={() =>
                save(
                  p.order,
                  p.hidden.includes(id)
                    ? p.hidden.filter((x) => x !== id)
                    : [...p.hidden, id],
                )
              }
            />
            {CARD_LABELS[id]}
          </label>
          <button
            className="secondary"
            aria-label={`Move ${CARD_LABELS[id]} up`}
            disabled={i === 0}
            onClick={() => {
              const order = [...p.order];
              [order[i - 1], order[i]] = [order[i], order[i - 1]];
              save(order);
            }}
          >
            ↑
          </button>
          <button
            className="secondary"
            aria-label={`Move ${CARD_LABELS[id]} down`}
            disabled={i === p.order.length - 1}
            onClick={() => {
              const order = [...p.order];
              [order[i + 1], order[i]] = [order[i], order[i + 1]];
              save(order);
            }}
          >
            ↓
          </button>
        </div>
      ))}
      <h3 className="settings-subheading">Your top three priorities today</h3>
      <p className="muted">
        Choose up to three unfinished tasks, including future tasks you want to
        focus on today.
      </p>
      {data.tasks
        .filter((t) => !t.completed)
        .map((t) => (
          <label className="check-label" key={t.id}>
            <input
              type="checkbox"
              checked={p.priorities.includes(t.id)}
              disabled={
                !p.priorities.includes(t.id) && p.priorities.length >= 3
              }
              onChange={() =>
                save(
                  p.order,
                  p.hidden,
                  p.priorities.includes(t.id)
                    ? p.priorities.filter((id) => id !== t.id)
                    : [...p.priorities, t.id],
                )
              }
            />
            {t.name}
          </label>
        ))}
      {!data.tasks.some((t) => !t.completed) && (
        <p className="empty">Add tasks to choose your daily priorities.</p>
      )}
      <button
        className="secondary"
        onClick={() => save([...DASHBOARD_CARDS], [], [])}
      >
        Reset dashboard preferences
      </button>
    </>
  );
}
