import { describe, it, expect } from "vitest";
import { emptyWorkspace, weeklyReview } from "./personal";
import { day } from "./dates";
import {
  habitPlan,
  habitComplete,
  habitWeek,
  habitStreak,
  scheduled,
  editHabitPlan,
  setHabitCount,
  dashboardPreferences,
  DASHBOARD_CARDS,
  backupReminder,
  workspaceContent,
  parseExportStatus,
} from "./daily";
import { validateWorkspace, deletion, undoDeletion } from "./safety";
import type { Habit, State } from "./data";
const habit: Habit = {
  name: "Walk",
  dates: ["2026-10-05", "2026-10-07"],
  createdOn: "2026-10-05",
  schedule: [1, 3, 5],
  target: 1,
};
describe("scheduled habit progress", () => {
  it("excludes rest days and days before creation from percentages", () => {
    expect(habitWeek(habit, "2026-10-08")).toEqual({
      possible: 2,
      complete: 2,
      percent: 100,
    });
    expect(scheduled(habit, "2026-10-08")).toBe(false);
    expect(scheduled(habit, "2026-10-02")).toBe(false);
  });
  it("keeps streaks across rest days and an unfinished current day", () => {
    expect(habitStreak(habit, "2026-10-08")).toBe(2);
    expect(habitStreak(habit, "2026-10-09")).toBe(2);
    expect(habitStreak(habit, "2026-10-10")).toBe(0);
  });
  it("preserves historical targets when schedules change", () => {
    const edited = editHabitPlan(habit, "Walk", 3, [2, 4], "2026-10-08");
    expect(habitPlan(edited, "2026-10-07").target).toBe(1);
    expect(habitComplete(edited, "2026-10-07")).toBe(true);
    expect(habitPlan(edited, "2026-10-08").target).toBe(3);
    expect(habitWeek(edited, "2026-10-08")).toEqual({
      possible: 3,
      complete: 2,
      percent: 67,
    });
  });
  it("counts progress only as complete once target reached, retaining legacy progress", () => {
    let state: State = {
      ...emptyWorkspace(),
      habits: [{ ...habit, target: 3 }],
    };
    expect(habitComplete(state.habits[0], "2026-10-07")).toBe(false);
    state = setHabitCount(state, 0, 2, "2026-10-07");
    expect(state.habits[0].dates).not.toContain("2026-10-07");
    state = setHabitCount(state, 0, 3, "2026-10-07");
    expect(habitComplete(state.habits[0], "2026-10-07")).toBe(true);
    expect(() => setHabitCount(state, 0, -1)).toThrow();
  });
  it("rejects invalid targets, counts, schedules and history", () => {
    for (const patch of [
      { target: 0 },
      { schedule: [] },
      { schedule: [7] },
      { counts: { bad: 1 } },
      { counts: { "2026-10-08": -1 } },
      { scheduleHistory: [{ effectiveOn: "bad", days: [1], target: 1 }] },
    ])
      expect(() =>
        validateWorkspace({
          ...emptyWorkspace(),
          habits: [{ ...habit, ...patch }],
        }),
      ).toThrow();
    expect(() => editHabitPlan(habit, "Walk", 1, [])).toThrow();
  });
  it("uses scheduled opportunities in weekly review", () => {
    const r = weeklyReview(
      { ...emptyWorkspace(), habits: [habit] },
      "2026-10-08",
    );
    expect(r.habitPossible).toBe(2);
    expect(r.habitPercent).toBe(100);
  });
});
describe("personalization and reminders", () => {
  it("normalizes partial card order and resets priorities on a new day", () => {
    const state = {
      ...emptyWorkspace(),
      tasks: ["a", "b", "c"].map((id) => ({
        id,
        name: id,
        category: "Personal",
        priority: "High" as const,
        due: day(),
        completed: false,
        recurring: false,
      })),
      preferences: {
        dashboard: {
          order: ["fitness", "fitness", "future"],
          hidden: ["dates"],
        },
        priorities: { date: day(), ids: ["a", "b", "c"] },
      },
    };
    expect(dashboardPreferences(state).order).toEqual([
      "fitness",
      ...DASHBOARD_CARDS.filter((c) => c !== "fitness"),
    ]);
    expect(dashboardPreferences(state).priorities).toHaveLength(3);
    state.tasks[0].completed = true;
    expect(dashboardPreferences(state).priorities).toEqual(["b", "c"]);
    state.preferences.priorities.date = "2000-01-01";
    expect(dashboardPreferences(state).priorities).toEqual([]);
    expect(() =>
      validateWorkspace({
        ...state,
        preferences: { priorities: { date: day(), ids: ["a", "b", "c", "d"] } },
      }),
    ).toThrow();
  });
  it("reminds only after a week, respecting dismissal and explicit saved-file confirmation", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    const status = { requestedAt: new Date(now).toISOString(), content: "{}" };
    expect(backupReminder(status, 0, now)).toBe(true);
    expect(backupReminder(null, now + 1, now)).toBe(false);
    expect(
      backupReminder(
        { ...status, confirmedAt: new Date(now - 6 * 86400000).toISOString() },
        0,
        now,
      ),
    ).toBe(false);
    expect(
      backupReminder(
        { ...status, confirmedAt: new Date(now - 7 * 86400000).toISOString() },
        0,
        now,
      ),
    ).toBe(true);
  });
  it("detects actual workspace changes independently of export timestamps", () => {
    const state = emptyWorkspace();
    expect(
      workspaceContent({ ...state, exportedAt: "2026-10-01" } as typeof state),
    ).toBe(workspaceContent(state));
    expect(workspaceContent({ ...state, goalWeight: 150 })).not.toBe(
      workspaceContent(state),
    );
  });
  it("updates corrected historical fitness summaries and supports deletion Undo", () => {
    const state = {
      ...emptyWorkspace(),
      weights: [
        { date: "2026-10-05", value: 180 },
        { date: "2026-10-08", value: 175 },
      ],
      nutrition: [
        { date: "2026-10-08", calories: 2000, protein: 150, steps: 8000 },
      ],
    };
    expect(weeklyReview(state, "2026-10-08").weightChange).toBe(-5);
    const corrected = {
      ...state,
      weights: [state.weights[0], { date: "2026-10-08", value: 178 }],
      nutrition: [{ ...state.nutrition[0], steps: 10000 }],
    };
    expect(weeklyReview(corrected, "2026-10-08").weightChange).toBe(-2);
    expect(weeklyReview(corrected, "2026-10-08").stepAverage).toBe(10000);
    const removed = { ...corrected, weights: [], nutrition: [] };
    expect(
      undoDeletion(removed, deletion(corrected, removed, "fitness")),
    ).toEqual(validateWorkspace(corrected));
  });
});

describe("V1.3 data compatibility", () => {
  it("rejects malformed backup metadata without suppressing reminders", () => {
    for (const raw of [
      "{bad",
      "null",
      JSON.stringify({ requestedAt: "bad", content: "{}" }),
      JSON.stringify({
        requestedAt: "2026-10-08T12:00:00Z",
        content: "{}",
        confirmedAt: "bad",
      }),
    ]) {
      expect(parseExportStatus(raw)).toBeNull();
      expect(backupReminder(parseExportStatus(raw), 0)).toBe(true);
    }
  });
  it("round trips counted workout sets and nested personal preferences without dropping extensions", () => {
    const state = {
      ...emptyWorkspace(),
      workouts: [
        {
          id: "w",
          date: "2026-10-08",
          name: "Strength",
          exercise: "Bench",
          weight: 195,
          reps: 6,
          sets: 3,
          completed: true,
          extension: { keep: true },
        },
      ],
      habits: [{ ...habit, counts: { "2026-10-07": 1 }, extension: true }],
      preferences: {
        dashboard: { order: ["fitness"], hidden: ["dates"], extension: true },
        extension: true,
      },
    };
    expect(validateWorkspace(state)).toMatchObject(state);
    expect(() =>
      validateWorkspace({
        ...state,
        workouts: [{ ...state.workouts[0], sets: 0 }],
      }),
    ).toThrow();
    expect(() =>
      validateWorkspace({
        ...state,
        workouts: [{ ...state.workouts[0], sets: 1.5 }],
      }),
    ).toThrow();
  });
});
