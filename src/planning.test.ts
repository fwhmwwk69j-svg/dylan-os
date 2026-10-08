import { describe, it, expect } from "vitest";
import {
  emptyWorkspace,
  validateWorkspace,
  exportWorkspace,
  parseImport,
  persist,
  snapshots,
  restoreSnapshot,
  deletion,
  undoDeletion,
  summary,
  STORAGE_KEY,
  clearWorkspace,
} from "./safety";
import type { State, Commitment, WeeklyReflection } from "./data";
import {
  planDays,
  weekStart,
  commitmentsOn,
  saveCommitment,
  skipCommitment,
  saveReflection,
  weekPriorities,
  fitnessProgress,
} from "./planning";
import { coordinatedWrite } from "./crossTab";
const commitment: Commitment = {
  id: "c",
  name: "Physics lecture",
  kind: "Class",
  days: [1, 3],
  startTime: "09:00",
  endTime: "10:00",
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  exceptions: ["2026-10-07"],
};
const reflection: WeeklyReflection = {
  id: "r",
  weekStart: "2026-09-28",
  reflection: "A good week",
  priorities: ["Study physics", "Train three times", "Read daily"],
  savedAt: "2026-10-04T12:00:00Z",
};
function fixture(): State {
  return {
    ...emptyWorkspace(),
    commitments: [commitment],
    weeklyReflections: [reflection],
    fitnessGoals: {
      calories: 2300,
      protein: 160,
      steps: 10000,
      weeklyWorkouts: 3,
    },
    goalWeight: 175,
  };
}
function store(state: State) {
  const m = new Map([[STORAGE_KEY, JSON.stringify(state)]]);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}
describe("seven-day planning and recurrence", () => {
  it("connects every existing area without copying or mutating records", () => {
    const s = fixture();
    s.tasks = [
      {
        id: "t",
        name: "Task",
        category: "Personal",
        priority: "High",
        due: "2026-10-05",
        completed: false,
        recurring: false,
      },
    ];
    s.courses = [
      {
        id: "course",
        name: "Physics",
        code: "PHY",
        instructor: "",
        notes: "",
        grade: null,
      },
    ];
    s.assignments = [
      {
        id: "a",
        courseId: "course",
        name: "Exam",
        type: "Exam",
        due: "2026-10-06",
        completed: false,
      },
    ];
    s.workouts = [
      {
        id: "w",
        name: "Upper",
        exercise: "Bench",
        date: "2026-10-05",
        weight: 185,
        reps: 5,
        completed: false,
      },
    ];
    s.habits = [
      { name: "Read", dates: [], createdOn: "2026-10-05", schedule: [1, 3] },
    ];
    s.dates = [{ name: "Birthday", date: "2026-10-05" }];
    const original = JSON.stringify(s);
    const days = planDays(s, "2026-10-05");
    expect(days).toHaveLength(7);
    expect(days[0].tasks[0]).toBe(s.tasks[0]);
    expect(days[1].school[0]).toBe(s.assignments[0]);
    expect(days[0].workouts[0]).toBe(s.workouts[0]);
    expect(days[0].habits).toHaveLength(1);
    expect(days[1].habits).toHaveLength(0);
    expect(days[0].dates).toHaveLength(1);
    expect(JSON.stringify(s)).toBe(original);
  });
  it("honors weekdays, inclusive date bounds, and exception dates", () => {
    const s = fixture();
    expect(commitmentsOn(s, "2026-10-05")).toHaveLength(1);
    expect(commitmentsOn(s, "2026-10-07")).toHaveLength(0);
    expect(commitmentsOn(s, "2026-10-06")).toHaveLength(0);
    expect(commitmentsOn(s, "2026-09-30")).toHaveLength(0);
    expect(commitmentsOn(s, "2026-11-02")).toHaveLength(0);
    expect(
      planDays(s, "2026-10-05").flatMap((d) => d.commitments),
    ).toHaveLength(1);
  });
  it("edits a series and idempotently skips occurrences without duplicate records", () => {
    const s = saveCommitment(fixture(), {
      ...commitment,
      name: "Updated class",
    });
    expect(s.commitments).toHaveLength(1);
    const skipped = skipCommitment(
      skipCommitment(s, "c", "2026-10-05"),
      "c",
      "2026-10-05",
    );
    expect(skipped.commitments[0].exceptions).toEqual([
      "2026-10-07",
      "2026-10-05",
    ]);
    expect(commitmentsOn(skipped, "2026-10-05")).toHaveLength(0);
    expect(() =>
      saveCommitment(s, {
        ...s.commitments[0],
        id: "duplicate",
        exceptions: [],
      }),
    ).toThrow(/already exists/);
  });
  it("computes seven local dates across month/year/leap-day boundaries", () => {
    expect(planDays(emptyWorkspace(), "2026-12-29").at(-1)?.date).toBe(
      "2027-01-04",
    );
    expect(planDays(emptyWorkspace(), "2028-02-27")[2].date).toBe("2028-02-29");
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
  it.each([
    { days: [] },
    { days: [1, 1] },
    { startTime: "25:00" },
    { endTime: "08:00" },
    { endsOn: "2026-09-30" },
    { exceptions: ["2026-02-30"] },
    { exceptions: ["2026-10-07", "2026-10-07"] },
    { kind: "invalid" },
  ])("rejects malformed recurrence %j", (patch) => {
    expect(() =>
      validateWorkspace({
        ...fixture(),
        commitments: [{ ...commitment, ...patch }],
      }),
    ).toThrow();
  });
});
describe("goals and saved reflections", () => {
  it("counts workouts as calendar-week sessions and never converts missing logs to zero", () => {
    const s = fixture();
    s.workouts = [
      {
        id: "a",
        date: "2026-10-05",
        name: "Upper",
        exercise: "Bench",
        weight: 185,
        reps: 5,
        sets: 3,
        completed: true,
      },
      {
        id: "b",
        date: "2026-10-05",
        name: "Upper",
        exercise: "Row",
        weight: 100,
        reps: 8,
        completed: true,
      },
      {
        id: "c",
        date: "2026-10-04",
        name: "Last week",
        exercise: "Row",
        weight: 100,
        reps: 8,
        completed: true,
      },
      {
        id: "d",
        date: "2026-10-09",
        name: "Future",
        exercise: "Row",
        weight: 100,
        reps: 8,
        completed: true,
      },
    ];
    const progress = fitnessProgress(s, "2026-10-08");
    expect(progress.sessions).toBe(1);
    expect(progress.nutrition).toBeUndefined();
    expect(progress.weight).toBeNull();
    expect(progress.goals.steps).toBe(10000);
  });
  it("uses corrected weights/nutrition and supports unset goals", () => {
    const s = fixture();
    s.weights = [
      { date: "2026-10-07", value: 179 },
      { date: "2026-10-01", value: 180 },
      { date: "2026-10-20", value: 170 },
    ];
    s.nutrition = [
      { date: "2026-10-08", calories: 2300, protein: 160, steps: 10000 },
    ];
    expect(fitnessProgress(s, "2026-10-08")).toMatchObject({
      weight: 179,
      nutrition: { steps: 10000 },
    });
    expect(fitnessProgress(emptyWorkspace()).goals).toEqual({
      calories: null,
      protein: null,
      steps: null,
      weeklyWorkouts: null,
    });
  });
  it.each([
    { steps: -1 },
    { weeklyWorkouts: 1.5 },
    { calories: 0 },
    { protein: 2001 },
  ])("rejects invalid goals %j", (patch) => {
    expect(() =>
      validateWorkspace({
        ...fixture(),
        fitnessGoals: { ...fixture().fitnessGoals, ...patch },
      }),
    ).toThrow();
  });
  it("updates one reflection per week, keeps its ID and extensions, and publishes priorities only to the following week", () => {
    const s = fixture();
    Object.assign(s.weeklyReflections[0], { extension: "keep" });
    const next = saveReflection(s, {
      ...reflection,
      id: "new",
      reflection: "Updated",
    });
    expect(next.weeklyReflections).toHaveLength(1);
    expect(next.weeklyReflections[0]).toMatchObject({
      id: "r",
      reflection: "Updated",
      extension: "keep",
    });
    expect(weekPriorities(next, "2026-10-05")).toEqual(reflection.priorities);
    expect(weekPriorities(next, "2026-10-11")).toHaveLength(3);
    expect(weekPriorities(next, "2026-10-12")).toEqual([]);
  });
  it.each([
    { weekStart: "2026-10-06" },
    { priorities: ["one"] },
    { priorities: ["one", "One", "three"] },
    { savedAt: "bad" },
  ])("rejects invalid reflection %j", (patch) => {
    expect(() =>
      validateWorkspace({
        ...fixture(),
        weeklyReflections: [{ ...reflection, ...patch }],
      }),
    ).toThrow();
  });
  it("rejects duplicate reflection weeks and IDs", () => {
    expect(() =>
      validateWorkspace({
        ...fixture(),
        weeklyReflections: [reflection, { ...reflection, id: "other" }],
      }),
    ).toThrow(/Duplicate/);
  });
});
describe("complete recovery and compatibility", () => {
  it("migrates actual V1.3 JSON lacking new fields without changing old records", () => {
    const {
      commitments: ignored,
      weeklyReflections: ignored2,
      ...legacy
    } = emptyWorkspace();
    void ignored;
    void ignored2;
    const loaded = parseImport(
      JSON.stringify({
        ...legacy,
        schemaVersion: 4,
        extension: { keep: true },
      }),
    );
    expect(loaded).toMatchObject({
      schemaVersion: 5,
      commitments: [],
      weeklyReflections: [],
      extension: { keep: true },
    });
  });
  it("requires the new collections in schema 5 and rejects unsupported versions", () => {
    const s = fixture();
    expect(() =>
      parseImport(
        JSON.stringify({ ...s, schemaVersion: 5, commitments: undefined }),
      ),
    ).toThrow(/commitments/);
    expect(() =>
      parseImport(JSON.stringify({ ...s, schemaVersion: 6 })),
    ).toThrow(/Unsupported/);
  });
  it("exports/imports every new field and previews collection counts", () => {
    const s = fixture();
    Object.assign(s.commitments[0], { extension: { keep: true } });
    Object.assign(s.fitnessGoals!, { extension: "keep" });
    const exported = exportWorkspace(s);
    expect(parseImport(JSON.stringify(exported))).toEqual(exported);
    expect(exported).toMatchObject({
      schemaVersion: 5,
      commitments: s.commitments,
      weeklyReflections: s.weeklyReflections,
      fitnessGoals: s.fitnessGoals,
    });
    expect(summary(s)).toMatchObject({ commitments: 1, weeklyReflections: 1 });
  });
  it("snapshots edits and clearing, restores new data, and undoes both new deletions without losing later edits", () => {
    const s = fixture(),
      storage = store(s);
    const next = { ...s, commitments: [], weeklyReflections: [] };
    const entry = deletion(s, next, "planning");
    persist(storage, s, next, "Before deleting planning");
    const undone = undoDeletion({ ...next, goalWeight: 170 }, entry);
    expect(undone).toMatchObject({
      commitments: s.commitments,
      weeklyReflections: s.weeklyReflections,
      goalWeight: 170,
    });
    expect(restoreSnapshot(storage, next, snapshots(storage)[0])).toMatchObject(
      s,
    );
    clearWorkspace(storage, s, "CLEAR MY WORKSPACE");
    expect(JSON.parse(snapshots(storage)[0].raw)).toMatchObject(s);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({
      commitments: [],
      weeklyReflections: [],
    });
  });
  it("blocks stale new-data edits before any snapshot or write", async () => {
    const s = fixture(),
      storage = store(s);
    const raw = storage.getItem(STORAGE_KEY);
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...s, goalWeight: 170 }));
    const locks = {
      request: (_n: unknown, _o: unknown, cb: () => unknown) =>
        Promise.resolve().then(cb),
    } as unknown as Pick<LockManager, "request">;
    await expect(
      coordinatedWrite(
        storage,
        s,
        { ...s, commitments: [] },
        raw,
        "Planner edit",
        locks,
      ),
    ).rejects.toThrow(/another tab/);
    expect(snapshots(storage)).toHaveLength(0);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({
      goalWeight: 170,
      commitments: s.commitments,
    });
  });
});
