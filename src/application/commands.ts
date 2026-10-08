import type { State, Task, Assignment } from "../data";
import { uid } from "../data";
import { day } from "../dates";
import { editHabitPlan } from "../daily";
import { validateWorkspace, emptyWorkspace } from "../safety";
import type { Collection } from "../domain/collections";
export type FormKind =
  | "task"
  | "course"
  | "assignment"
  | "weight"
  | "workout"
  | "nutrition"
  | "habit"
  | "date";
export type FormSelection = {
  taskId?: string;
  courseId?: string;
  assignmentId?: string;
  logDate?: string;
  workoutId?: string;
  habitId?: string;
  dateId?: string;
};
export function saveFormCommand(
  state: State,
  kind: FormKind,
  f: Pick<FormData, "get" | "getAll">,
  selected: FormSelection = {},
  today = day(),
  newId: () => string = uid,
): State {
  const value = (key: string) => String(f.get(key) ?? "");
  const number = (key: string) => Number(f.get(key));
  let next = state;
  if (kind === "task") {
    const old = state.tasks.find((t) => t.id === selected.taskId);
    const t: Task = {
      ...old,
      id: old?.id ?? newId(),
      name: value("name").trim(),
      category: value("category"),
      priority: value("priority") as Task["priority"],
      due: value("due"),
      completed: old?.completed ?? false,
      recurring: f.get("recurring") === "on",
      completedOn: old?.completedOn,
    };
    next = {
      ...state,
      tasks: old
        ? state.tasks.map((x) => (x.id === t.id ? t : x))
        : [...state.tasks, t],
    };
  }
  if (kind === "course") {
    const old = state.courses.find((c) => c.id === selected.courseId);
    const c = {
      ...old,
      id: old?.id ?? newId(),
      name: value("name").trim(),
      code: value("code").trim(),
      instructor: value("instructor"),
      grade: value("grade") === "" ? null : number("grade"),
      notes: value("notes"),
    };
    next = {
      ...state,
      courses: old
        ? state.courses.map((x) => (x.id === c.id ? c : x))
        : [...state.courses, c],
    };
  }
  if (kind === "assignment") {
    const old = state.assignments.find((a) => a.id === selected.assignmentId);
    const a: Assignment = {
      ...old,
      id: old?.id ?? newId(),
      name: value("name").trim(),
      courseId: value("courseId"),
      due: value("due"),
      type: value("type") as Assignment["type"],
      completed: old?.completed ?? false,
      completedOn: old?.completedOn,
      grade: value("grade") === "" ? null : number("grade"),
      notes: value("notes"),
    };
    next = {
      ...state,
      assignments: old
        ? state.assignments.map((x) => (x.id === a.id ? a : x))
        : [...state.assignments, a],
    };
  }
  if (kind === "weight" || kind === "nutrition") {
    const collection = kind === "weight" ? "weights" : "nutrition";
    const date = value("date");
    const originalDate = selected.logDate ?? date;
    if (selected.logDate && date !== selected.logDate)
      throw new Error(
        "Edit the existing dated entry without changing its date.",
      );
    if (date > today)
      throw new Error("Historical logs cannot be in the future.");
    const old = state[collection].find((r) => r.date === originalDate);
    const entry = {
      ...old,
      id: old?.id ?? newId(),
      date,
      ...(kind === "weight"
        ? { value: number("weight") }
        : {
            calories: number("calories"),
            protein: number("protein"),
            steps: number("steps"),
          }),
    };
    next = {
      ...state,
      [collection]: [
        ...state[collection].filter((r) => r.date !== originalDate),
        entry,
      ],
      ...(kind === "weight"
        ? { goalWeight: value("goal") === "" ? null : number("goal") }
        : {}),
    };
  }
  if (kind === "workout") {
    if (!value("name").trim() || !value("exercise").trim())
      throw new Error("Enter a workout and exercise name.");
    if (value("status") === "Completed" && value("date") > today)
      throw new Error(
        "Choose Planned for a future workout, or log a past/current date.",
      );
    const old = state.workouts.find((w) => w.id === selected.workoutId);
    const w = {
      ...old,
      id: old?.id ?? newId(),
      date: value("date"),
      name: value("name").trim(),
      exercise: value("exercise").trim(),
      weight: number("weight"),
      reps: number("reps"),
      sets: number("sets"),
      completed: value("status") === "Completed",
    };
    next = {
      ...state,
      workouts: old
        ? state.workouts.map((x) => (x.id === w.id ? w : x))
        : [...state.workouts, w],
    };
  }
  if (kind === "habit") {
    const old = state.habits.find((h) => h.id === selected.habitId);
    const name = value("name").trim();
    if (
      state.habits.some(
        (h) => h.id !== old?.id && h.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("That habit already exists.");
    const days = [...new Set(f.getAll("schedule").map(Number))];
    if (!days.length) throw new Error("Choose at least one scheduled day.");
    const h = old
      ? editHabitPlan(old, name, number("target"), days, today)
      : {
          id: newId(),
          name,
          dates: [],
          createdOn: today,
          target: number("target"),
          schedule: days,
        };
    next = {
      ...state,
      habits: old
        ? state.habits.map((x) => (x.id === old.id ? h : x))
        : [...state.habits, h],
    };
  }
  if (kind === "date") {
    const old = state.dates.find((d) => d.id === selected.dateId);
    const d = {
      ...old,
      id: old?.id ?? newId(),
      name: value("name").trim(),
      date: value("date"),
    };
    next = {
      ...state,
      dates: old
        ? state.dates.map((x) => (x.id === d.id ? d : x))
        : [...state.dates, d],
    };
  }
  return validateWorkspace(next);
}
export function deleteRecord(
  state: State,
  collection: Collection,
  id: string,
): State {
  if (!state[collection].some((r) => r.id === id))
    throw new Error("Record to delete does not exist.");
  return {
    ...state,
    [collection]: state[collection].filter((r) => r.id !== id),
    ...(collection === "courses"
      ? { assignments: state.assignments.filter((a) => a.courseId !== id) }
      : {}),
  };
}
export function courseNotes(state: State, id: string, notes: string): State {
  if (!state.courses.some((c) => c.id === id))
    throw new Error("Course does not exist.");
  return {
    ...state,
    courses: state.courses.map((c) => (c.id === id ? { ...c, notes } : c)),
  };
}
export function toggleWorkout(state: State, id: string, today = day()): State {
  const record = state.workouts.find((w) => w.id === id);
  if (!record) throw new Error("Workout does not exist.");
  if (!record.completed && record.date > today)
    throw new Error("Complete on or after the planned date.");
  return {
    ...state,
    workouts: state.workouts.map((w) =>
      w.id === id ? { ...w, completed: !w.completed } : w,
    ),
  };
}
export function clearCommand(confirmation: string) {
  if (confirmation !== "CLEAR MY WORKSPACE")
    throw new Error("Type CLEAR MY WORKSPACE to confirm.");
  return emptyWorkspace();
}
export const FORM_KINDS: readonly FormKind[] = [
  "task",
  "course",
  "assignment",
  "weight",
  "workout",
  "nutrition",
  "habit",
  "date",
];
export function isFormKind(value: unknown): value is FormKind {
  return FORM_KINDS.includes(value as FormKind);
}
export function formSnapshotReason(
  state: State,
  kind: FormKind,
  f: Pick<FormData, "get">,
  selected: FormSelection,
) {
  const editing =
    kind === "task"
      ? selected.taskId
      : kind === "course"
        ? selected.courseId
        : kind === "assignment"
          ? selected.assignmentId
          : kind === "habit"
            ? selected.habitId
            : kind === "date"
              ? selected.dateId
              : kind === "workout"
                ? selected.workoutId
                : state[kind === "weight" ? "weights" : "nutrition"].some(
                    (r) => r.date === String(f.get("date")),
                  );
  return editing ? `Before editing ${kind}` : undefined;
}
