import { describe, it, expect } from "vitest";
import { sampleData, type State } from "./data";
import { emptyWorkspace, removeCourse, STORAGE_KEY } from "./personal";
import {
  exportWorkspace,
  backupFilename,
  parseImport,
  validateWorkspace,
  persist,
  snapshots,
  restoreSnapshot,
  clearWorkspace,
  deletion,
  undoDeletion,
  BACKUP_KEY,
  MAX_BACKUPS,
  MAX_IMPORT_BYTES,
  SCHEMA_VERSION,
  type Store,
} from "./safety";
function store(initial?: State) {
  const values = new Map<string, string>();
  if (initial) values.set(STORAGE_KEY, JSON.stringify(initial));
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
}
describe("export and import", () => {
  it("exports the entire workspace with schema/timestamp and unknown fields intact", () => {
    const s = { ...sampleData(), custom: { nested: "keep" } };
    Object.assign(s.tasks[0], { customTask: "keep" });
    const exported = exportWorkspace(s, new Date("2026-10-07T12:00:00Z"));
    expect(exported.schemaVersion).toBe(SCHEMA_VERSION);
    expect(exported.exportedAt).toBe("2026-10-07T12:00:00.000Z");
    for (const key of [
      "tasks",
      "courses",
      "assignments",
      "weights",
      "workouts",
      "nutrition",
      "habits",
      "dates",
      "goalWeight",
    ] as const)
      expect(exported[key]).toEqual(s[key]);
    expect(parseImport(JSON.stringify(exported))).toEqual(exported);
    expect(exported).toMatchObject({ custom: s.custom });
    expect(backupFilename(new Date(2026, 9, 7))).toBe(
      "dylan-os-backup-2026-10-07.json",
    );
  });
  it.each([undefined, 1, 2, 3])(
    "accepts and migrates legacy schema %s without inventing completion dates",
    (schemaVersion) => {
      const s = { ...sampleData(), schemaVersion };
      const loaded = parseImport(JSON.stringify(s));
      expect(loaded).toEqual({ ...s, schemaVersion: 3 });
      expect(loaded.tasks[0].completedOn).toBeUndefined();
    },
  );
  it.each([0, 4, 999, "3", null])(
    "rejects unsupported schema %s",
    (schemaVersion) => {
      expect(() =>
        parseImport(JSON.stringify({ ...sampleData(), schemaVersion })),
      ).toThrow();
    },
  );
  it.each(["{", "null", "[]", "{}", '{"tasks":[]}'])(
    "rejects malformed JSON/structure %s",
    (raw) => expect(() => parseImport(raw)).toThrow(),
  );
  it.each([
    "tasks",
    "courses",
    "assignments",
    "weights",
    "workouts",
    "nutrition",
    "habits",
    "dates",
  ])("requires collection %s", (key) => {
    const s = { ...sampleData() } as unknown as Record<string, unknown>;
    delete s[key];
    expect(() => validateWorkspace(s)).toThrow();
    s[key] = {};
    expect(() => validateWorkspace(s)).toThrow();
  });
  it("rejects invalid dates, values, status, IDs, links, and history", () => {
    const mutations = [
      (s: State) => (s.tasks[0].due = "2026-02-30"),
      (s: State) => (s.tasks[0].priority = "Urgent" as never),
      (s: State) => (s.tasks[0].completed = "yes" as never),
      (s: State) => s.tasks.push(s.tasks[0]),
      (s: State) => (s.assignments[0].courseId = "missing"),
      (s: State) => (s.courses[0].grade = 101),
      (s: State) => (s.weights[0].value = -1),
      (s: State) => (s.nutrition[0].steps = 1.5),
      (s: State) => (s.workouts[0].reps = 0),
      (s: State) => (s.habits[0].dates = ["bad-date"]),
    ];
    for (const mutate of mutations) {
      const s = sampleData();
      mutate(s);
      expect(() => validateWorkspace(s)).toThrow();
    }
  });
  it("rejects invalid timestamps and oversize input", () => {
    expect(() =>
      parseImport(
        JSON.stringify({ ...sampleData(), exportedAt: "not a timestamp" }),
      ),
    ).toThrow();
    expect(() => parseImport(" ".repeat(MAX_IMPORT_BYTES + 1))).toThrow();
  });
  it("does not touch storage for failed validation", () => {
    const s = sampleData(),
      storage = store(s);
    const original = storage.getItem(STORAGE_KEY);
    expect(() =>
      persist(storage, s, { ...s, courses: [] } as State, "Invalid import"),
    ).toThrow();
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
    expect(snapshots(storage)).toEqual([]);
  });
});
describe("snapshots and clearing", () => {
  it("snapshots the exact stored data before replacement and successfully restores it", () => {
    const original = { ...sampleData(), unknown: "preserve" };
    const storage = store(original);
    persist(storage, original, emptyWorkspace(), "Before import");
    const snapshot = snapshots(storage)[0];
    expect(JSON.parse(snapshot.raw)).toEqual(original);
    const restored = restoreSnapshot(storage, emptyWorkspace(), snapshot);
    expect(restored).toEqual({ ...original, schemaVersion: 3 });
    expect(snapshots(storage)[0].reason).toBe("Before restoring backup");
    expect(JSON.parse(snapshots(storage)[0].raw).tasks).toHaveLength(0);
  });
  it("rotates to exactly five newest snapshots", () => {
    const s = sampleData(),
      storage = store(s);
    for (let i = 0; i < 9; i++) persist(storage, s, s, `Change ${i}`);
    const history = snapshots(storage);
    expect(history).toHaveLength(MAX_BACKUPS);
    expect(history.map((s) => s.reason)).toEqual([
      "Change 8",
      "Change 7",
      "Change 6",
      "Change 5",
      "Change 4",
    ]);
    expect(new Set(history.map((s) => s.id)).size).toBe(5);
  });
  it("requires exact clear confirmation and backs up immediately before clearing", () => {
    const s = sampleData(),
      storage = store(s);
    expect(() => clearWorkspace(storage, s, "CLEAR")).toThrow();
    expect(snapshots(storage)).toHaveLength(0);
    const cleared = clearWorkspace(storage, s, "CLEAR MY WORKSPACE");
    expect(cleared).toEqual({ ...emptyWorkspace(), schemaVersion: 3 });
    expect(JSON.parse(snapshots(storage)[0].raw)).toEqual(s);
    expect(snapshots(storage)[0].reason).toBe("Before clearing workspace");
  });
  it("blocks destructive writes if the prerequisite snapshot cannot be saved", () => {
    const s = sampleData(),
      storage = store(s);
    const failing: Store = {
      getItem: storage.getItem,
      setItem: (k, v) => {
        if (k === BACKUP_KEY) throw new Error("Quota exceeded");
        storage.setItem(k, v);
      },
    };
    expect(() => clearWorkspace(failing, s, "CLEAR MY WORKSPACE")).toThrow(
      "Quota exceeded",
    );
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(s);
  });
  it("leaves the current workspace and its recovery snapshot intact if workspace write fails", () => {
    const s = sampleData(),
      storage = store(s);
    const failing: Store = {
      getItem: storage.getItem,
      setItem: (k, v) => {
        if (k === STORAGE_KEY) throw new Error("Workspace write failed");
        storage.setItem(k, v);
      },
    };
    expect(() =>
      persist(failing, s, emptyWorkspace(), "Before change"),
    ).toThrow();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(s);
    expect(JSON.parse(snapshots(storage)[0].raw)).toEqual(s);
  });
  it("rejects broken snapshot data and broken backup history without replacing current data", () => {
    const s = sampleData(),
      storage = store(s);
    expect(() =>
      restoreSnapshot(storage, s, {
        id: "bad",
        createdAt: "now",
        reason: "bad",
        raw: "{}",
      }),
    ).toThrow();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(s);
    storage.setItem(BACKUP_KEY, "broken");
    expect(() => clearWorkspace(storage, s, "CLEAR MY WORKSPACE")).toThrow();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(s);
  });
  it("preserves unreadable original bytes in a snapshot during explicit recovery", () => {
    const storage = store();
    storage.setItem(STORAGE_KEY, "{corrupt");
    persist(storage, emptyWorkspace(), sampleData(), "Recover");
    expect(snapshots(storage)[0].raw).toBe("{corrupt");
  });
});
describe("temporary deletion undo", () => {
  it.each(["tasks", "assignments", "workouts", "habits", "dates"] as const)(
    "restores deleted %s and preserves intervening changes",
    (key) => {
      const before = sampleData();
      const after = { ...before, [key]: before[key].slice(1) };
      const entry = deletion(before, after, key, 1000);
      const current = { ...after, goalWeight: 160 };
      const restored = undoDeletion(current, entry, 1001);
      expect(restored[key]).toHaveLength(before[key].length);
      expect(restored[key]).toContainEqual(before[key][0]);
      expect(restored.goalWeight).toBe(160);
    },
  );
  it("restores a course together with all linked school work and unknown metadata", () => {
    const before = sampleData();
    Object.assign(before.courses[0], { unknown: "keep" });
    before.assignments.push({
      ...before.assignments[0],
      id: "additional-linked",
      courseId: "c1",
      notes: "Preserve linked notes",
    });
    const after = removeCourse(before, "c1");
    const restored = undoDeletion(
      after,
      deletion(before, after, "course", 1000),
      1001,
    );
    expect(restored.courses).toContainEqual(before.courses[0]);
    expect(restored.assignments.filter((a) => a.courseId === "c1")).toEqual(
      before.assignments.filter((a) => a.courseId === "c1"),
    );
    expect(restored.assignments).toContainEqual(
      before.assignments.find((a) => a.courseId === "c1"),
    );
  });
  it("keeps a task added after deletion and edits to surviving tasks", () => {
    const before = sampleData();
    const after = { ...before, tasks: before.tasks.slice(1) };
    const entry = deletion(before, after, "task", 1000);
    const current = {
      ...after,
      tasks: [
        ...after.tasks.map((t) => ({ ...t, name: "Edited " + t.name })),
        { ...before.tasks[0], id: "added", name: "New task" },
      ],
    };
    const restored = undoDeletion(current, entry, 1001);
    expect(restored.tasks.find((t) => t.id === "added")?.name).toBe("New task");
    expect(restored.tasks.find((t) => t.id === after.tasks[0].id)?.name).toBe(
      "Edited " + after.tasks[0].name,
    );
    expect(restored.tasks.find((t) => t.id === before.tasks[0].id)).toEqual(
      before.tasks[0],
    );
  });
  it("expires after 30 seconds", () => {
    const before = sampleData();
    const after = { ...before, tasks: before.tasks.slice(1) };
    expect(() =>
      undoDeletion(after, deletion(before, after, "task", 1000), 31000),
    ).toThrow("expired");
  });
  it("refuses to overwrite a conflicting newer record", () => {
    const before = sampleData();
    const after = { ...before, tasks: before.tasks.slice(1) };
    const entry = deletion(before, after, "task", 1000);
    const current = {
      ...after,
      tasks: [...after.tasks, { ...before.tasks[0], name: "New record" }],
    };
    expect(() => undoDeletion(current, entry, 1001)).toThrow("conflict");
    expect(current.tasks.at(-1)?.name).toBe("New record");
  });
});
