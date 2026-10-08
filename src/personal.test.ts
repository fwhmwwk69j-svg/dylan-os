import { validateWorkspace } from "./safety";
import { describe, it, expect } from "vitest";
import { sampleData, toggleTask, type Task, type Assignment } from "./data";
import {
  emptyWorkspace,
  restoreWorkspace,
  urgency,
  dueTasks,
  schoolWorkload,
  toggleAssignment,
  toggleHabit,
  removeCourse,
  weeklyReview,
  offsetDate,
} from "./personal";
const today = "2026-10-07";
const task = (
  id: string,
  due: string,
  priority: Task["priority"] = "Medium",
): Task => ({
  id,
  name: id,
  category: "Personal",
  due,
  priority,
  completed: false,
  recurring: false,
});
const assignment = (
  id: string,
  due: string,
  type: Assignment["type"] = "Assignment",
): Assignment => ({
  id,
  name: id,
  courseId: "c1",
  due,
  type,
  completed: false,
});
describe("personal workspace and compatibility", () => {
  it("starts empty without fabricated school or fitness records", () => {
    const s = restoreWorkspace(null);
    expect(s).toEqual(emptyWorkspace());
    expect(s.courses).toHaveLength(0);
    expect(s.weights).toHaveLength(0);
    expect(s.goalWeight).toBeNull();
  });
  it("preserves every V1 record, edits, unknown metadata and completion status", () => {
    const old = sampleData();
    old.courses[0].notes = "My real notes";
    old.tasks[0].completed = true;
    const migrated = restoreWorkspace(
      JSON.stringify({ ...old, customField: "keep" }),
    );
    expect(migrated).toEqual(
      validateWorkspace({ ...old, customField: "keep" }),
    );
    expect(migrated.tasks[0].completedOn).toBeUndefined();
    expect(restoreWorkspace(JSON.stringify(migrated))).toEqual(migrated);
  });
  it("rejects malformed saved data rather than silently replacing it", () => {
    expect(() => restoreWorkspace("{")).toThrow();
    expect(() => restoreWorkspace('{"tasks":[]}')).toThrow();
  });
  it("deleting a course removes only its linked work", () => {
    const s = sampleData();
    const next = removeCourse(s, "c1");
    expect(next.courses.some((c) => c.id === "c1")).toBe(false);
    expect(next.assignments.some((a) => a.courseId === "c1")).toBe(false);
    expect(next.assignments.filter((a) => a.courseId !== "c1")).toEqual(
      s.assignments.filter((a) => a.courseId !== "c1"),
    );
    expect(next.tasks).toEqual(s.tasks);
  });
});
describe("Today urgency and prioritization", () => {
  it.each([
    ["2026-10-06", "Overdue"],
    [today, "Due today"],
    ["2026-10-08", "Tomorrow"],
    ["2026-10-10", "Due soon"],
    ["2026-10-11", undefined],
  ])("classifies %s", (due, label) =>
    expect(urgency(due, false, today)?.label).toBe(label),
  );
  it("does not mark completed items urgent", () =>
    expect(urgency("2020-01-01", true, today)).toBeNull());
  it("keeps all overdue tasks before today, then sorts matching dates by priority", () => {
    const s = emptyWorkspace();
    s.tasks = [
      task("low", today, "Low"),
      task("overdue", "2026-10-01", "Low"),
      task("high", today, "High"),
      task("future", "2026-10-08"),
      { ...task("done", "2026-10-01"), completed: true },
    ];
    expect(dueTasks(s, today).map((t) => t.id)).toEqual([
      "overdue",
      "high",
      "low",
    ]);
    expect(s.tasks[0].id).toBe("low");
  });
  it("includes overdue exams and imminent assignments while excluding completed and distant work", () => {
    const s = emptyWorkspace();
    s.assignments = [
      assignment("overdue", "2026-10-01", "Exam"),
      assignment("boundary", "2026-10-14"),
      assignment("later", "2026-10-15"),
      { ...assignment("done", today), completed: true },
    ];
    expect(schoolWorkload(s, today).map((a) => a.id)).toEqual([
      "overdue",
      "boundary",
    ]);
  });
  it("handles calendar boundaries without UTC date conversion", () => {
    expect(offsetDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(offsetDate("2026-03-08", 1)).toBe("2026-03-09");
    expect(offsetDate("2028-03-01", -1)).toBe("2028-02-29");
  });
});
describe("completion dates and weekly review", () => {
  it("records and clears task completion dates, with future recurrence free of stale metadata", () => {
    const s = emptyWorkspace();
    s.tasks = [{ ...task("repeat", "2026-10-01"), recurring: true }];
    const next = toggleTask(s, "repeat", today);
    expect(next.tasks[0].completedOn).toBe(today);
    expect(next.tasks[1].due).toBe("2026-10-08");
    expect(next.tasks[1].completedOn).toBeUndefined();
    expect(
      toggleTask(next, "repeat", today).tasks[0].completedOn,
    ).toBeUndefined();
  });
  it("records assignment completion date and clears it on reopen", () => {
    const s = emptyWorkspace();
    s.assignments = [assignment("a", "2026-09-01")];
    const next = toggleAssignment(s, "a", today);
    expect(next.assignments[0].completedOn).toBe(today);
    expect(
      toggleAssignment(next, "a", today).assignments[0].completedOn,
    ).toBeUndefined();
  });
  it("counts actual completion dates, excluding legacy, future and older completions", () => {
    const s = emptyWorkspace();
    s.tasks = [
      { ...task("late", "2026-09-01"), completed: true, completedOn: today },
      { ...task("legacy", today), completed: true },
      { ...task("old", today), completed: true, completedOn: "2026-09-30" },
      { ...task("future", today), completed: true, completedOn: "2026-10-08" },
    ];
    s.assignments = [
      {
        ...assignment("a", "2026-01-01"),
        completed: true,
        completedOn: "2026-10-01",
      },
      {
        ...assignment("exam", today, "Exam"),
        completed: true,
        completedOn: today,
      },
    ];
    const r = weeklyReview(s, today);
    expect(r.tasksCompleted).toBe(1);
    expect(r.assignmentsCompleted).toBe(2);
    expect(r.legacyCompletions).toBe(1);
  });
  it("uses logged days for steps and chronological weights for the trend", () => {
    const s = emptyWorkspace();
    s.nutrition = [
      { date: "2026-10-01", calories: 0, protein: 0, steps: 0 },
      { date: today, calories: 0, protein: 0, steps: 10000 },
      { date: "2026-09-30", calories: 0, protein: 0, steps: 99999 },
    ];
    s.weights = [
      { date: today, value: 180 },
      { date: "2026-10-01", value: 182 },
      { date: "2026-10-08", value: 500 },
    ];
    const r = weeklyReview(s, today);
    expect(r.stepAverage).toBe(5000);
    expect(r.stepDays).toBe(2);
    expect(r.weightChange).toBe(-2);
  });
  it("does not fabricate trends or averages when no data exists", () => {
    const r = weeklyReview(emptyWorkspace(), today);
    expect(r.stepAverage).toBeNull();
    expect(r.weightChange).toBeNull();
    expect(r.habitPercent).toBeNull();
  });
  it("deduplicates working sets when counting workout sessions", () => {
    const s = sampleData();
    const w = { ...s.workouts[0], date: today, completed: true };
    s.workouts = [
      w,
      { ...w, id: "second" },
      { ...w, id: "planned", completed: false },
      { ...w, id: "older", date: "2026-09-30" },
      { ...w, id: "future", date: "2026-10-08" },
    ];
    expect(weeklyReview(s, today).sessions).toBe(1);
  });
  it("counts habit opportunities only since creation, with duplicate check-ins counted once", () => {
    const s = emptyWorkspace();
    s.habits = [
      {
        name: "New habit",
        createdOn: "2026-10-06",
        dates: ["2026-10-05", "2026-10-06", "2026-10-06", today],
      },
      { name: "Legacy habit", dates: [today] },
    ];
    const r = weeklyReview(s, today);
    expect(r.habitPossible).toBe(9);
    expect(r.habitCompleted).toBe(3);
    expect(r.habitPercent).toBe(33);
  });
  it("allows a dated habit check-in and undo without changing other habits", () => {
    const s = emptyWorkspace();
    s.habits = [
      { name: "Read", dates: [] },
      { name: "Walk", dates: [] },
    ];
    const next = toggleHabit(s, 0, today);
    expect(next.habits[0].dates).toEqual([today]);
    expect(next.habits[1].dates).toEqual([]);
    expect(toggleHabit(next, 0, today).habits[0].dates).toEqual([]);
  });
});
