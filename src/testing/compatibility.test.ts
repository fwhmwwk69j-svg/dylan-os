import { describe, it, expect } from "vitest";
import { compatibilityFixture } from "./compatibilityFixtures";
import {
  validateWorkspace,
  parseImport,
  exportWorkspace,
  STORAGE_KEY,
  persist,
  snapshots,
  restoreSnapshot,
} from "../safety";
import { LocalWorkspaceRepository } from "../persistence/localRepository";
import { COLLECTIONS } from "../domain/collections";
for (const version of ["unversioned", 1, 2, 3, 4, 5, 6] as const) {
  describe(`synthetic schema ${version}`, () => {
    it("normalizes idempotently without mutation, preserving identities, order, fields and links", () => {
      const fixture = compatibilityFixture(version);
      const raw = JSON.stringify(fixture);
      const state = validateWorkspace(fixture);
      expect(JSON.stringify(fixture)).toBe(raw);
      expect(validateWorkspace(state)).toEqual(state);
      for (const collection of COLLECTIONS)
        expect(validateWorkspace(state)[collection]).toEqual(state[collection]);
      expect(state.tasks.map((r) => r.id)).toEqual(["z-task", "a-task"]);
      expect(state.courses[0].id).toBe("legacy/course");
      expect(state.assignments[0].courseId).toBe(state.courses[0].id);
      expect(state.assignments[0]).not.toHaveProperty("notes");
      expect(state.assignments[0].grade).toBeNull();
      expect(state).not.toHaveProperty("fitnessGoals");
      expect(state).toHaveProperty("futureRoot.nested", [null, { keep: true }]);
      expect(state.tasks[0]).toHaveProperty("future.tags", ["synthetic"]);
      expect(new Set(state.habits.map((r) => r.id)).size).toBe(2);
      if (version === 6) expect(state.weights[0].id).toBe("existing-weight");
      const exported = exportWorkspace(state, new Date("2026-10-09T12:00:00Z"));
      expect(parseImport(JSON.stringify(exported))).toEqual(exported);
    });
    it("loads without writes and restores old backup bytes with a pre-restore snapshot", async () => {
      const raw = JSON.stringify(compatibilityFixture(version));
      const values = new Map([[STORAGE_KEY, raw]]);
      const store = {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      };
      const repository = new LocalWorkspaceRepository(store, null);
      const loaded = await repository.load();
      expect(values.size).toBe(1);
      expect(await repository.original()).toBe(raw);
      const changed = { ...loaded.data, goalWeight: 155 };
      persist(store, loaded.data, changed, "Synthetic edit");
      expect(snapshots(store)[0].raw).toBe(raw);
      const beforeRestore = values.get(STORAGE_KEY);
      const restored = restoreSnapshot(store, changed, snapshots(store)[0]);
      expect(restored).toEqual(loaded.data);
      expect(snapshots(store)[0].raw).toBe(beforeRestore);
      expect(repository.identity).toEqual(repository.owner);
      expect(repository.capabilities.offlineWrites).toBe(true);
    });
  });
}

it("preserves mixed legacy IDs and explicit optional goal/history values", () => {
  const fixture = compatibilityFixture(5);
  (fixture.weights as Record<string, unknown>[])[0].id =
    "preserved-legacy-weight";
  fixture.fitnessGoals = {
    calories: null,
    protein: 100,
    steps: null,
    weeklyWorkouts: 3,
    future: { keep: true },
  };
  fixture.preferences = {
    priorities: { date: "2026-10-09", ids: ["z-task"] },
    future: { keep: true },
  };
  const state = validateWorkspace(fixture);
  expect(state.weights[0].id).toBe("preserved-legacy-weight");
  expect(state.fitnessGoals).toEqual(fixture.fitnessGoals);
  expect(state.preferences).toEqual(fixture.preferences);
  expect(state.habits[0].counts).toEqual({ "2026-10-09": 1 });
  expect(state.habits[0].scheduleHistory).toEqual([
    { effectiveOn: "2026-10-01", days: [1, 3], target: 1 },
  ]);
  expect(validateWorkspace(state)).toEqual(state);
});
it("rejects broken academic links and duplicate schema-6 identities without repairing source records", () => {
  const fixture = compatibilityFixture(6);
  (fixture.assignments as Record<string, unknown>[])[0].courseId =
    "missing-course";
  const raw = JSON.stringify(fixture);
  expect(() => validateWorkspace(fixture)).toThrow();
  expect(JSON.stringify(fixture)).toBe(raw);
  const duplicate = compatibilityFixture(6);
  const habits = duplicate.habits as Record<string, unknown>[];
  habits[1].id = habits[0].id;
  expect(() => validateWorkspace(duplicate)).toThrow(/Duplicate/);
});
