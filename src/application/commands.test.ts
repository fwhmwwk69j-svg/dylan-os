import { describe, expect, it } from "vitest";
import { sampleData } from "../data";
import { validateWorkspace } from "../safety";
import { saveFormCommand, formSnapshotReason, deleteRecord } from "./commands";
function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const today = "2026-10-08";
describe("complete form command contracts", () => {
  it.each([
    [
      "course",
      {
        name: "New course",
        code: "NEW",
        instructor: "Teacher",
        grade: "95",
        notes: "Notes",
      },
      "courses",
    ],
    [
      "assignment",
      {
        name: "Exam",
        courseId: "c1",
        due: today,
        type: "Exam",
        grade: "",
        notes: "Exam notes",
      },
      "assignments",
    ],
    [
      "nutrition",
      { date: "2026-09-01", calories: "2200", protein: "160", steps: "9000" },
      "nutrition",
    ],
    [
      "workout",
      {
        date: today,
        name: "Strength",
        exercise: "Bench",
        weight: "185",
        reps: "5",
        sets: "3",
        status: "Completed",
      },
      "workouts",
    ],
    ["date", { name: "Important", date: today }, "dates"],
  ] as const)(
    "creates %s with stable identity and leaves input untouched",
    (kind, values, collection) => {
      const state = validateWorkspace(sampleData()),
        before = structuredClone(state);
      const next = saveFormCommand(
        state,
        kind,
        form(values),
        {},
        today,
        () => "new-id",
      );
      expect(state).toEqual(before);
      expect(next[collection]).toHaveLength(state[collection].length + 1);
      expect(next[collection].at(-1)?.id).toBe("new-id");
      expect(validateWorkspace(next)).toEqual(next);
    },
  );
  it("updates exam and course identity, grade, notes, metadata and completion", () => {
    const state = validateWorkspace(sampleData());
    const a = state.assignments[0],
      c = state.courses[0];
    Object.assign(a, {
      extension: "keep",
      completed: true,
      completedOn: "2026-10-01",
    });
    Object.assign(c, { extension: "keep" });
    const changed = saveFormCommand(
      state,
      "assignment",
      form({
        name: "Updated exam",
        courseId: a.courseId,
        due: a.due,
        type: "Exam",
        grade: "88",
        notes: "Updated",
      }),
      { assignmentId: a.id },
      today,
    );
    expect(changed.assignments[0]).toEqual({
      ...a,
      name: "Updated exam",
      type: "Exam",
      grade: 88,
      notes: "Updated",
    });
    const courses = saveFormCommand(
      state,
      "course",
      form({
        name: c.name,
        code: c.code,
        instructor: c.instructor,
        grade: "",
        notes: "Updated",
      }),
      { courseId: c.id },
      today,
    );
    expect(courses.courses[0]).toEqual({ ...c, grade: null, notes: "Updated" });
  });
  it("upserts nutrition without changing the ID or duplicating the date", () => {
    const state = validateWorkspace(sampleData()),
      old = state.nutrition[0];
    Object.assign(old, { extra: "keep" });
    const f = form({
      date: old.date,
      calories: "2400",
      protein: "170",
      steps: "10000",
    });
    const next = saveFormCommand(state, "nutrition", f, {}, today);
    expect(next.nutrition).toHaveLength(state.nutrition.length);
    expect(next.nutrition[0]).toEqual({
      ...old,
      calories: 2400,
      protein: 170,
      steps: 10000,
    });
    expect(formSnapshotReason(state, "nutrition", f, {})).toBe(
      "Before editing nutrition",
    );
    expect(() =>
      saveFormCommand(state, "nutrition", f, { logDate: "2026-10-01" }, today),
    ).toThrow(/without changing/);
  });
  it("edits important date and workout without losing unknown fields", () => {
    const state = validateWorkspace(sampleData()),
      old = state.dates[0],
      workout = state.workouts[0];
    Object.assign(old, { extra: "keep" });
    Object.assign(workout, { extra: "keep" });
    const dates = saveFormCommand(
      state,
      "date",
      form({ name: "Renamed", date: today }),
      { dateId: old.id },
      today,
    );
    expect(dates.dates[0]).toEqual({ ...old, name: "Renamed", date: today });
    const workouts = saveFormCommand(
      state,
      "workout",
      form({
        date: workout.date,
        name: workout.name,
        exercise: workout.exercise,
        weight: "200",
        reps: "6",
        sets: "4",
        status: "Completed",
      }),
      { workoutId: workout.id },
      today,
    );
    expect(workouts.workouts[0]).toEqual({
      ...workout,
      weight: 200,
      reps: 6,
      sets: 4,
      completed: true,
    });
  });
  it("rejects missing delete targets and invalid course references without mutation", () => {
    const state = validateWorkspace(sampleData()),
      before = structuredClone(state);
    expect(() => deleteRecord(state, "tasks", "missing")).toThrow();
    expect(() =>
      saveFormCommand(
        state,
        "assignment",
        form({
          name: "Invalid",
          courseId: "missing",
          due: today,
          type: "Assignment",
          grade: "",
          notes: "",
        }),
        {},
        today,
      ),
    ).toThrow();
    expect(state).toEqual(before);
  });
});
