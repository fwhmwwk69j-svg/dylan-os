import { recurringOn } from "./domain/scheduling";
import { weekday } from "./dates";
import type { State, Commitment, WeeklyReflection, FitnessGoals } from "./data";
import { day } from "./dates";
import { offsetDate } from "./personal";
import { scheduled } from "./daily";
import { validateWorkspace } from "./safety";
export function weekStart(date = day()) {
  return offsetDate(date, -((weekday(date) + 6) % 7));
}
export function commitmentsOn(state: State, date: string) {
  return state.commitments
    .filter((c) => recurringOn(c, date))
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name),
    );
}
export function planDays(state: State, start = day()) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = offsetDate(start, i);
    return {
      date,
      tasks: state.tasks.filter((t) => t.due === date),
      school: state.assignments.filter((a) => a.due === date),
      workouts: state.workouts.filter((w) => w.date === date),
      habits: state.habits
        .map((h, index) => ({ h, index }))
        .filter(({ h }) => scheduled(h, date)),
      commitments: commitmentsOn(state, date),
      dates: state.dates.filter((d) => d.date === date),
    };
  });
}
export function saveCommitment(state: State, record: Commitment): State {
  return validateWorkspace({
    ...state,
    commitments: state.commitments.some((c) => c.id === record.id)
      ? state.commitments.map((c) =>
          c.id === record.id ? { ...c, ...record } : c,
        )
      : [...state.commitments, record],
  });
}
export function skipCommitment(state: State, id: string, date: string): State {
  return validateWorkspace({
    ...state,
    commitments: state.commitments.map((c) =>
      c.id === id
        ? { ...c, exceptions: [...new Set([...c.exceptions, date])] }
        : c,
    ),
  });
}
export function saveReflection(state: State, record: WeeklyReflection): State {
  const old = state.weeklyReflections.find(
    (r) => r.weekStart === record.weekStart,
  );
  return validateWorkspace({
    ...state,
    weeklyReflections: old
      ? state.weeklyReflections.map((r) =>
          r.id === old.id ? { ...r, ...record, id: old.id } : r,
        )
      : [...state.weeklyReflections, record],
  });
}
export function weekPriorities(state: State, date = day()) {
  return (
    state.weeklyReflections.find(
      (r) => r.weekStart === offsetDate(weekStart(date), -7),
    )?.priorities ?? []
  );
}
export function goalsFor(state: State): FitnessGoals {
  return (
    state.fitnessGoals ?? {
      calories: null,
      protein: null,
      steps: null,
      weeklyWorkouts: null,
    }
  );
}
export function fitnessProgress(state: State, date = day()) {
  const start = weekStart(date),
    end = offsetDate(start, 6);
  const sessions = new Set(
    state.workouts
      .filter(
        (w) =>
          w.completed && w.date >= start && w.date <= end && w.date <= date,
      )
      .map((w) => `${w.date}:${w.name}`),
  ).size;
  const nutrition = state.nutrition.find((n) => n.date === date);
  const weight =
    [...state.weights]
      .filter((w) => w.date <= date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.value ?? null;
  return { goals: goalsFor(state), sessions, nutrition, weight, start, end };
}
