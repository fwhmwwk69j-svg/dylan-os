import { validateWorkspace, emptyWorkspace } from "./safety";
import { day, localDate } from "./dates";
import type { State, Task, Assignment } from "./data";
export { STORAGE_KEY, emptyWorkspace } from "./safety";
// Additive migration: never reseed or silently discard the user's Version 1 records.
export function restoreWorkspace(raw: string | null): State {
  if (!raw) return emptyWorkspace();
  return validateWorkspace(JSON.parse(raw));
}
export function offsetDate(date: string, offset: number) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + offset);
  return localDate(d);
}
export function urgency(due: string, completed = false, today = day()) {
  if (completed) return null;
  if (due < today) return { level: "overdue", label: "Overdue" };
  if (due === today) return { level: "due-today", label: "Due today" };
  if (due === offsetDate(today, 1)) return { level: "soon", label: "Tomorrow" };
  if (due <= offsetDate(today, 3)) return { level: "soon", label: "Due soon" };
  return null;
}
export function dueTasks(state: State, today = day()) {
  return state.tasks
    .filter((t) => !t.completed && t.due <= today)
    .sort(
      (a, b) =>
        a.due.localeCompare(b.due) ||
        ["High", "Medium", "Low"].indexOf(a.priority) -
          ["High", "Medium", "Low"].indexOf(b.priority),
    );
}
export function schoolWorkload(state: State, today = day(), days = 7) {
  return state.assignments
    .filter((a) => !a.completed && a.due <= offsetDate(today, days))
    .sort((a, b) => a.due.localeCompare(b.due));
}
export function toggleAssignment(
  state: State,
  id: string,
  today = day(),
): State {
  return {
    ...state,
    assignments: state.assignments.map((a) =>
      a.id === id
        ? {
            ...a,
            completed: !a.completed,
            completedOn: a.completed ? undefined : today,
          }
        : a,
    ),
  };
}
export function toggleHabit(state: State, index: number, date = day()): State {
  return {
    ...state,
    habits: state.habits.map((h, i) =>
      i === index
        ? {
            ...h,
            dates: h.dates.includes(date)
              ? h.dates.filter((d) => d !== date)
              : [...h.dates, date],
          }
        : h,
    ),
  };
}
export function removeCourse(state: State, id: string): State {
  return {
    ...state,
    courses: state.courses.filter((c) => c.id !== id),
    assignments: state.assignments.filter((a) => a.courseId !== id),
  };
}
export function weeklyReview(state: State, end = day()) {
  const start = offsetDate(end, -6),
    nextEnd = offsetDate(end, 7);
  const within = (d: string) => d >= start && d <= end;
  const completions = (items: (Task | Assignment)[]) =>
    items.filter((x) => x.completed && x.completedOn && within(x.completedOn));
  const weightEntries = state.weights
    .filter((w) => within(w.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const workouts = state.workouts.filter((w) => w.completed && within(w.date));
  const sessions = new Set(workouts.map((w) => `${w.date}:${w.name}`)).size;
  const steps = state.nutrition.filter((n) => within(n.date));
  let habitPossible = 0,
    habitCompleted = 0;
  for (const habit of state.habits) {
    for (let i = 0; i < 7; i++) {
      const date = offsetDate(start, i);
      if (!habit.createdOn || date >= habit.createdOn) {
        habitPossible++;
        if (habit.dates.includes(date)) habitCompleted++;
      }
    }
  }
  return {
    start,
    end,
    tasksCompleted: completions(state.tasks).length,
    assignmentsCompleted: completions(state.assignments).length,
    legacyCompletions: [...state.tasks, ...state.assignments].filter(
      (x) => x.completed && !x.completedOn,
    ).length,
    workload: schoolWorkload(state, end),
    nextEnd,
    weightChange:
      weightEntries.length >= 2
        ? weightEntries.at(-1)!.value - weightEntries[0].value
        : null,
    weightEntries,
    sessions,
    stepAverage: steps.length
      ? steps.reduce((sum, n) => sum + n.steps, 0) / steps.length
      : null,
    stepDays: steps.length,
    habitCompleted,
    habitPossible,
    habitPercent: habitPossible
      ? Math.round((habitCompleted / habitPossible) * 100)
      : null,
  };
}
