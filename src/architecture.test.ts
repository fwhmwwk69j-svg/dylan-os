import { describe, it, expect } from "vitest";
import { sampleData } from "./data";
import {
  validateWorkspace,
  parseImport,
  exportWorkspace,
  snapshots,
  STORAGE_KEY,
  BACKUP_KEY,
} from "./safety";
import { LEGACY_ID_COLLECTIONS, COLLECTIONS } from "./domain/collections";
import { LocalWorkspaceRepository } from "./persistence/localRepository";
import { WorkspaceController } from "./application/workspaceController";
import {
  saveFormCommand,
  deleteRecord,
  courseNotes,
  toggleWorkout,
} from "./application/commands";
import { addCalendarDays, todayInZone, weekday } from "./dates";
import {
  occurrenceKey,
  recurringOn,
  overlaps,
  scheduleContract,
} from "./domain/scheduling";
import {
  assertRelationship,
  resolveRecord,
  habitLogRef,
  DOMAIN_CONTRACT,
} from "./domain/contracts";
import { selectAiContext, ACCESS_CONTRACT } from "./platform/access";
import { MODULES, CURRENT_ROUTES, COMMERCIAL_POLICY } from "./platform/modules";
function fixture(version = 5) {
  const data = structuredClone(sampleData());
  const root = {
    ...data,
    schemaVersion: version,
    extension: { preserve: true },
  };
  Object.assign(root.habits[0], {
    extension: { private: "retain" },
    dates: ["2026-10-01"],
  });
  if (version < 5) {
    delete (root as Partial<typeof root>).commitments;
    delete (root as Partial<typeof root>).weeklyReflections;
  }
  return root;
}
function memory(raw = JSON.stringify(fixture())) {
  const values = new Map([[STORAGE_KEY, raw]]);
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  let tail = Promise.resolve();
  const locks = {
    request: (_name: unknown, _options: unknown, work: () => unknown) => {
      const next = tail.then(work);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  } as unknown as Pick<LockManager, "request">;
  return {
    store,
    locks,
    repository: new LocalWorkspaceRepository(store, locks),
  };
}
function form(values: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const entry of Array.isArray(v) ? v : [v]) f.append(k, entry);
  return f;
}
describe("identity migration across released workspaces", () => {
  it.each([1, 2, 3, 4, 5])(
    "preserves Version schema %s and remains idempotent",
    async (version) => {
      const original = fixture(version),
        raw = JSON.stringify(original);
      const { store, repository } = memory(raw);
      const first = await repository.load(),
        second = await repository.load();
      expect(store.getItem(STORAGE_KEY)).toBe(raw);
      expect(snapshots(store)).toEqual([]);
      expect(first.data).toEqual(second.data);
      expect(validateWorkspace(first.data)).toEqual(first.data);
      for (const key of COLLECTIONS) {
        expect(first.data[key]).toHaveLength(original[key]?.length ?? 0);
        original[key]?.forEach((r, index) =>
          expect(first.data[key][index]).toMatchObject(r),
        );
      }
      for (const key of LEGACY_ID_COLLECTIONS)
        expect(new Set(first.data[key].map((r) => r.id)).size).toBe(
          first.data[key].length,
        );
      expect(first.data.assignments[0].courseId).toBe(
        original.assignments[0].courseId,
      );
      const exported = exportWorkspace(first.data);
      expect(parseImport(JSON.stringify(exported))).toEqual(exported);
      await repository.save({ data: first.data, expectedRevision: raw });
      expect(snapshots(store)[0].raw).toBe(raw);
      expect(snapshots(store)[0].reason).toMatch(/migrating/);
      expect((await repository.load()).data).toEqual(first.data);
      const restored = parseImport(snapshots(store)[0].raw);
      expect(restored).toEqual(first.data);
    },
  );
  it("preserves existing IDs and differentiates duplicate legacy rows without deleting either", () => {
    const raw = fixture();
    raw.dates.push({ ...raw.dates[0] });
    raw.habits.push({ ...raw.habits[0] });
    raw.weights[0].id = "old-existing-id";
    const migrated = validateWorkspace(raw);
    expect(migrated.weights[0].id).toBe("old-existing-id");
    expect(migrated.dates.at(-1)?.id).not.toBe(migrated.dates[0].id);
    expect(migrated.habits.at(-1)?.id).not.toBe(migrated.habits[0].id);
    expect(validateWorkspace(migrated)).toEqual(migrated);
    raw.dates[1].id = migrated.dates[0].id;
    const collision = validateWorkspace(raw);
    expect(collision.dates[1].id).toBe(migrated.dates[0].id);
    expect(new Set(collision.dates.map((r) => r.id)).size).toBe(
      raw.dates.length,
    );
  });
  it("does not derive identity from mutable metrics or unknown fields", () => {
    const a = fixture(),
      b = fixture();
    b.weights[0].value += 1;
    Object.assign(b.weights[0], { extra: "keep" });
    expect(validateWorkspace(a).weights[0].id).toBe(
      validateWorkspace(b).weights[0].id,
    );
  });
  it("rejects missing and duplicate schema-6 identities rather than repairing corrupt current data", () => {
    const data = validateWorkspace(fixture());
    delete data.weights[0].id;
    expect(() => validateWorkspace(data)).toThrow(/ID/);
    const other = validateWorkspace(fixture());
    other.habits[1].id = other.habits[0].id;
    expect(() => validateWorkspace(other)).toThrow();
  });
});
describe("repository and command coordinator", () => {
  it("serializes two repositories and rejects stale writes without extra snapshots", async () => {
    const { store, locks, repository } = memory();
    const other = new LocalWorkspaceRepository(store, locks);
    const a = await repository.load(),
      b = await other.load();
    const results = await Promise.allSettled([
      repository.save({
        data: { ...a.data, goalWeight: 160 },
        expectedRevision: a.revision,
      }),
      other.save({
        data: { ...b.data, goalWeight: 170 },
        expectedRevision: b.revision,
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(snapshots(store)).toHaveLength(1);
    expect((await other.load()).data.goalWeight).toBe(160);
  });
  it("blocks stale rendered revisions, but allows explicit reload and new edits", async () => {
    const { repository } = memory();
    const controller = new WorkspaceController(repository);
    await controller.load();
    const before = controller.getSnapshot();
    expect(await controller.save({ ...before.data, goalWeight: 160 })).toBe(
      true,
    );
    expect(
      await controller.save(
        { ...before.data, goalWeight: 170 },
        undefined,
        false,
        before.revision,
      ),
    ).toBe(false);
    expect(controller.getSnapshot().conflict).toBe(true);
    await controller.load();
    expect(controller.getSnapshot().data.goalWeight).toBe(160);
  });
  it("restores a deleted course and linked records through controller Undo", async () => {
    const { repository } = memory();
    const controller = new WorkspaceController(repository);
    await controller.load();
    const original = controller.getSnapshot().data;
    await controller.remove(
      deleteRecord(original, "courses", original.courses[0].id),
      "course",
    );
    expect(
      controller
        .getSnapshot()
        .data.assignments.some((a) => a.courseId === original.courses[0].id),
    ).toBe(false);
    expect(await controller.undoLast()).toBe(true);
    expect(controller.getSnapshot().data.courses).toContainEqual(
      original.courses[0],
    );
    expect(controller.getSnapshot().data.assignments).toEqual(
      original.assignments,
    );
  });
  it("backs up exact bytes before clear and refuses weak confirmation", async () => {
    const { repository, store } = memory();
    const original = store.getItem(STORAGE_KEY);
    const controller = new WorkspaceController(repository);
    await controller.load();
    expect(await controller.clear("CLEAR")).toBe(false);
    expect(snapshots(store)).toHaveLength(0);
    expect(await controller.clear("CLEAR MY WORKSPACE")).toBe(true);
    expect(snapshots(store)[0].raw).toBe(original);
    expect(controller.getSnapshot().data.tasks).toEqual([]);
  });
  it("protects malformed workspace until explicit recovery and retains original bytes", async () => {
    const { repository, store } = memory("{broken");
    const controller = new WorkspaceController(repository);
    expect(await controller.load()).toBe(false);
    expect(await controller.save(validateWorkspace(fixture()))).toBe(false);
    expect(store.getItem(STORAGE_KEY)).toBe("{broken");
    expect(await controller.clear("CLEAR MY WORKSPACE")).toBe(true);
    expect(snapshots(store)[0].raw).toBe("{broken");
  });
  it("blocks migration if its snapshot cannot be stored", async () => {
    const { store, locks } = memory();
    const raw = store.getItem(STORAGE_KEY);
    const repo = new LocalWorkspaceRepository(
      {
        ...store,
        setItem: (key, v) => {
          if (key === BACKUP_KEY) throw Error("Quota");
          store.setItem(key, v);
        },
      },
      locks,
    );
    const loaded = await repo.load();
    await expect(
      repo.save({ data: loaded.data, expectedRevision: raw }),
    ).rejects.toThrow(/Quota/);
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
  });
  it("rejects invalid imported data without changing the workspace", async () => {
    const { repository, store } = memory();
    const original = store.getItem(STORAGE_KEY);
    const loaded = await repository.load();
    await expect(
      repository.save({
        data: { ...loaded.data, courses: [] },
        expectedRevision: original,
      }),
    ).rejects.toThrow();
    expect(store.getItem(STORAGE_KEY)).toBe(original);
    expect(snapshots(store)).toEqual([]);
  });
});
describe("extracted application commands", () => {
  it("preserves stable identity and extensions when updating dated entries", () => {
    const state = validateWorkspace(fixture());
    const old = state.weights[0];
    Object.assign(old, { extension: "keep" });
    const next = saveFormCommand(
      state,
      "weight",
      form({ date: old.date, weight: "190", goal: "175" }),
      { logDate: old.date },
      "2026-10-08",
    );
    expect(next.weights).toHaveLength(state.weights.length);
    expect(next.weights.find((w) => w.date === old.date)).toEqual({
      ...old,
      value: 190,
    });
    expect(() =>
      saveFormCommand(
        state,
        "weight",
        form({ date: "2027-01-01", weight: "190", goal: "" }),
        {},
        "2026-10-08",
      ),
    ).toThrow(/future/);
  });
  it("renames a habit without losing its history, schedule or identity", () => {
    const state = validateWorkspace(fixture());
    const old = state.habits[0];
    const next = saveFormCommand(
      state,
      "habit",
      form({ name: "Renamed", target: "2", schedule: ["1", "3"] }),
      { habitId: old.id },
      "2026-10-08",
    );
    expect(next.habits[0]).toMatchObject({
      id: old.id,
      dates: old.dates,
      name: "Renamed",
      extension: { private: "retain" },
    });
    expect(() =>
      saveFormCommand(
        state,
        "habit",
        form({ name: old.name, target: "1", schedule: ["1"] }),
      ),
    ).toThrow(/already/);
  });
  it("preserves task completion, course notes and unknown fields on edits", () => {
    const state = validateWorkspace(fixture());
    const old = state.tasks[0];
    Object.assign(old, {
      extension: "keep",
      completed: true,
      completedOn: "2026-10-01",
    });
    const next = saveFormCommand(
      state,
      "task",
      form({
        name: "Edited",
        category: old.category,
        priority: old.priority,
        due: old.due,
      }),
      { taskId: old.id },
    );
    expect(next.tasks[0]).toMatchObject({
      id: old.id,
      extension: "keep",
      completed: true,
      completedOn: "2026-10-01",
    });
    expect(
      courseNotes(state, state.courses[0].id, "New note").courses[0],
    ).toEqual({ ...state.courses[0], notes: "New note" });
    expect(() =>
      toggleWorkout(
        {
          ...state,
          workouts: [
            { ...state.workouts[0], date: "2027-01-01", completed: false },
          ],
        },
        state.workouts[0].id,
        "2026-10-08",
      ),
    ).toThrow(/planned date/);
  });
});
describe("calendar and timezone contracts", () => {
  it.each([
    ["2026-03-08", "2026-03-09"],
    ["2026-11-01", "2026-11-02"],
    ["2028-02-28", "2028-02-29"],
    ["2026-12-31", "2027-01-01"],
  ])("uses calendar arithmetic across %s", (date, next) =>
    expect(addCalendarDays(date, 1)).toBe(next),
  );
  it("separates user-zone dates from instants and rejects invalid zones/dates", () => {
    const clock = { now: () => new Date("2026-10-08T02:00:00Z") };
    expect(todayInZone("America/New_York", clock)).toBe("2026-10-07");
    expect(todayInZone("Asia/Tokyo", clock)).toBe("2026-10-08");
    expect(() => todayInZone("Invalid/Zone", clock)).toThrow();
    expect(() => addCalendarDays("2026-02-30", 1)).toThrow();
    expect(weekday("2026-10-05")).toBe(1);
  });
  it("derives recurring occurrences with stable keys and inclusive boundaries", () => {
    const series = {
      days: [1],
      startsOn: "2026-10-05",
      endsOn: "2026-10-12",
      exceptions: ["2026-10-12"],
    };
    expect(recurringOn(series, "2026-10-05")).toBe(true);
    expect(recurringOn(series, "2026-10-12")).toBe(false);
    expect(recurringOn(series, "2026-10-19")).toBe(false);
    expect(occurrenceKey("series", "2026-10-05")).toBe(
      occurrenceKey("series", "2026-10-05"),
    );
    expect(scheduleContract(validateWorkspace(fixture())).mode).toBe(
      "floating-local",
    );
  });
  it("compares explicit instants with half-open boundaries", () => {
    const a = {
      startsAt: "2026-10-08T09:00:00-04:00",
      endsAt: "2026-10-08T10:00:00-04:00",
      timeZone: "America/New_York",
    };
    expect(
      overlaps(a, {
        startsAt: "2026-10-08T13:30:00Z",
        endsAt: "2026-10-08T14:30:00Z",
        timeZone: "UTC",
      }),
    ).toBe(true);
    expect(
      overlaps(a, {
        startsAt: "2026-10-08T14:00:00Z",
        endsAt: "2026-10-08T15:00:00Z",
        timeZone: "UTC",
      }),
    ).toBe(false);
    expect(() =>
      overlaps(a, { ...a, startsAt: "2026-10-08T09:00:00" }),
    ).toThrow();
  });
});
describe("domain ownership, inactive AI and module contracts", () => {
  const owner = { kind: "local" as const, workspaceId: "a" },
    other = { kind: "local" as const, workspaceId: "b" };
  it("permits valid owned relationships and rejects cross-owner or missing references", () => {
    const workspace = { owner, data: validateWorkspace(fixture()) };
    const assignment = workspace.data.assignments[0];
    assertRelationship(
      workspace,
      workspace,
      owner,
      { collection: "assignments", id: assignment.id },
      { collection: "courses", id: assignment.courseId },
    );
    expect(() =>
      resolveRecord(workspace, other, {
        collection: "tasks",
        id: workspace.data.tasks[0].id,
      }),
    ).toThrow(/ownership/);
    expect(() =>
      assertRelationship(
        workspace,
        { ...workspace, owner: other },
        owner,
        { collection: "assignments", id: assignment.id },
        { collection: "courses", id: assignment.courseId },
      ),
    ).toThrow(/ownership/);
    expect(() =>
      resolveRecord(workspace, owner, { collection: "tasks", id: "missing" }),
    ).toThrow();
    expect(habitLogRef("habit", "2026-10-08").id).toBe(
      habitLogRef("habit", "2026-10-08").id,
    );
    expect(() => habitLogRef("habit", "bad")).toThrow();
  });
  it("requires explicit owned AI grants and strips notes and unknown fields", () => {
    const workspace = { owner, data: validateWorkspace(fixture()) };
    Object.assign(workspace.data.courses[0], {
      notes: "private",
      secret: "private",
    });
    expect(() =>
      selectAiContext(workspace, owner, { owner, scopes: [] }, [
        "college.records",
      ]),
    ).toThrow(/granted/);
    expect(() =>
      selectAiContext(
        workspace,
        owner,
        { owner: other, scopes: ["college.records"] },
        ["college.records"],
      ),
    ).toThrow(/ownership/);
    const result = selectAiContext(
      workspace,
      owner,
      { owner, scopes: ["college.records"] },
      ["college.records"],
    );
    expect(result.courses?.[0]).not.toHaveProperty("notes");
    expect(result.courses?.[0]).not.toHaveProperty("secret");
    expect(result).not.toHaveProperty("weights");
    (result.courses![0] as { name: string }).name = "mutated";
    expect(workspace.data.courses[0].name).not.toBe("mutated");
    expect(ACCESS_CONTRACT).toMatchObject({
      active: false,
      importsGrantAuthority: false,
      entitlementIsAiConsent: false,
    });
    expect(DOMAIN_CONTRACT.portableOwnership).toBe(false);
  });
  it("registers six centers without exposing unfinished routes", () => {
    expect(MODULES).toHaveLength(6);
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(6);
    expect(
      CURRENT_ROUTES.some(
        (r) =>
          (r.module as string) === "finances" ||
          (r.module as string) === "library",
      ),
    ).toBe(false);
    const owned = MODULES.flatMap((m) => [...m.collections]);
    expect([...owned].sort()).toEqual([...COLLECTIONS].sort());
    expect(COMMERCIAL_POLICY).toEqual({
      minimumAge: 18,
      commercialLaunchEnabled: false,
    });
  });
});
