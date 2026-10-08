import { useState, type FormEvent } from "react";
import type { State, FitnessGoals } from "./data";
import { fitnessProgress } from "./planning";
export function GoalProgress({ data }: { data: State }) {
  const p = fitnessProgress(data);
  const configured =
    data.goalWeight !== null || Object.values(p.goals).some((v) => v !== null);
  return (
    <section className="card">
      <div className="card-heading">
        <h2>Fitness goals</h2>
      </div>
      {!configured ? (
        <p className="empty">Set your fitness goals on the Fitness page.</p>
      ) : (
        <div className="goal-progress">
          {data.goalWeight !== null && (
            <p>
              Weight: <strong>{p.weight ?? "Not logged"}</strong> /{" "}
              {data.goalWeight} lb goal
            </p>
          )}
          {(["calories", "protein", "steps"] as const).map(
            (key) =>
              p.goals[key] !== null && (
                <p key={key}>
                  {key === "calories"
                    ? "Calories"
                    : key === "protein"
                      ? "Protein"
                      : "Steps"}
                  : <strong>{p.nutrition?.[key] ?? "Not logged"}</strong> /{" "}
                  {p.goals[key]}
                  {key === "protein"
                    ? " g"
                    : key === "calories"
                      ? " kcal"
                      : ""}{" "}
                  today
                </p>
              ),
          )}
          {p.goals.weeklyWorkouts !== null && (
            <p>
              Workouts: <strong>{p.sessions}</strong> / {p.goals.weeklyWorkouts}{" "}
              this week{" "}
              <span className="row-meta">
                ({p.start}–{p.end})
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
export default function FitnessGoalsEditor({
  data,
  onChange,
}: {
  data: State;
  onChange: (next: State, reason: string) => Promise<boolean>;
}) {
  const p = fitnessProgress(data);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const number = (key: string) =>
      f.get(key) === "" ? null : Number(f.get(key));
    setBusy(true);
    setError("");
    const goals = {
      ...data.fitnessGoals,
      ...Object.fromEntries(
        ["calories", "protein", "steps", "weeklyWorkouts"].map((key) => [
          key,
          number(key),
        ]),
      ),
    } as FitnessGoals;
    if (
      !(await onChange(
        { ...data, goalWeight: number("weight"), fitnessGoals: goals },
        "Before changing fitness goals",
      ))
    )
      setError("Goals were not saved. Check the workspace warning.");
    setBusy(false);
  }
  return (
    <>
      <GoalProgress data={data} />
      <section className="card planner-editor">
        <div className="card-heading">
          <h2>Configure fitness goals</h2>
        </div>
        <p className="muted">
          Leave a field blank to remove that goal. Nutrition goals apply per
          day; workout goals use Monday–Sunday sessions.
        </p>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={save}>
          <div className="form-grid">
            {[
              {
                key: "weight",
                label: "Goal weight (lb)",
                max: 1500,
                step: 0.1,
                value: data.goalWeight,
              },
              {
                key: "calories",
                label: "Daily calorie goal",
                max: 20000,
                step: 1,
                value: p.goals.calories,
              },
              {
                key: "protein",
                label: "Daily protein goal (g)",
                max: 2000,
                step: 0.1,
                value: p.goals.protein,
              },
              {
                key: "steps",
                label: "Daily step goal",
                max: 100000,
                step: 1,
                value: p.goals.steps,
              },
              {
                key: "weeklyWorkouts",
                label: "Weekly workout goal",
                max: 21,
                step: 1,
                value: p.goals.weeklyWorkouts,
              },
            ].map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  name={field.key}
                  type="number"
                  min="1"
                  max={field.max}
                  step={field.step}
                  defaultValue={field.value ?? ""}
                />
              </label>
            ))}
          </div>
          <button className="primary" disabled={busy}>
            Save fitness goals
          </button>
        </form>
      </section>
    </>
  );
}
