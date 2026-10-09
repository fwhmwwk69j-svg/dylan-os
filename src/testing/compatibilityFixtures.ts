import { emptyWorkspace } from "../safety";
/** Fresh synthetic fixtures; never read browser storage or contain personal records. */
export function compatibilityFixture(
  version: number | "unversioned",
): Record<string, unknown> {
  const value = {
    ...emptyWorkspace(),
    futureRoot: { owner: "inert", nested: [null, { keep: true }] },
    tasks: ["z-task", "a-task"].map((id) => ({
      id,
      name: id,
      category: "Personal",
      priority: "High",
      due: "2026-10-09",
      completed: false,
      recurring: false,
      future: { tags: ["synthetic"] },
    })),
    courses: [
      {
        id: "legacy/course",
        name: "Synthetic course",
        code: "SYN",
        instructor: "",
        grade: null,
        notes: "",
        future: { keep: true },
      },
    ],
    assignments: [
      {
        id: "exam",
        courseId: "legacy/course",
        name: "Synthetic exam",
        due: "2026-10-10",
        type: "Exam",
        completed: false,
        grade: null,
      },
    ],
    workouts: [
      {
        id: "synthetic-workout",
        name: "Synthetic training",
        date: "2026-10-09",
        exercise: "Bench",
        weight: 100,
        reps: 5,
        completed: false,
      },
    ],
    commitments: [
      {
        id: "synthetic-series",
        name: "Synthetic class",
        kind: "Class",
        days: [1, 3],
        startTime: "09:00",
        endTime: "10:00",
        startsOn: "2026-10-01",
        endsOn: null,
        exceptions: ["2026-10-12"],
      },
    ],
    weeklyReflections: [
      {
        id: "synthetic-reflection",
        weekStart: "2026-10-05",
        reflection: "Synthetic reflection",
        priorities: ["First", "Second", "Third"],
        savedAt: "2026-10-09T12:00:00Z",
      },
    ],
    weights: [
      {
        date: "2026-10-09",
        value: 160,
        ...(version === 6 ? { id: "existing-weight" } : {}),
      },
    ],
    nutrition: [
      {
        date: "2026-10-09",
        calories: 2000,
        protein: 100,
        steps: 8000,
        ...(version === 6 ? { id: "existing-nutrition" } : {}),
      },
    ],
    habits: ["Same name", "Same name"].map((name, i) => ({
      name,
      dates: ["2026-10-09"],
      counts: { "2026-10-09": 1 },
      scheduleHistory: [{ effectiveOn: "2026-10-01", days: [1, 3], target: 1 }],
      ...(version === 6 ? { id: `existing-habit-${i}` } : {}),
      future: { count: i },
    })),
    dates: [
      {
        name: "Synthetic date",
        date: "2026-10-11",
        ...(version === 6 ? { id: "existing-date" } : {}),
      },
    ],
  } as Record<string, unknown>;
  if (version === "unversioned") delete value.schemaVersion;
  else value.schemaVersion = version;
  if (version === "unversioned" || version < 5) {
    delete value.commitments;
    delete value.weeklyReflections;
  }
  return value;
}
