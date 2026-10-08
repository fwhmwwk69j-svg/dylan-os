import { it, expect } from "vitest";
import { LocalWorkspaceRepository } from "./localRepository";
import { LocalPreferences } from "./preferences";
import { WorkspaceController } from "../application/workspaceController";
import type { WorkspaceRepository, WorkspaceRead } from "./repository";
import { emptyWorkspace, STORAGE_KEY } from "../safety";
import { EXPORT_STATUS_KEY, REMINDER_KEY } from "../daily";
it("loads an empty workspace without writing and exposes original recovery bytes", async () => {
  const values = new Map<string, string>();
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const repository = new LocalWorkspaceRepository(store, null);
  const loaded = await repository.load();
  expect(loaded.data).toEqual(emptyWorkspace());
  expect(loaded.revision).toBeNull();
  expect(values.size).toBe(0);
  expect(await repository.original()).toBeNull();
  await expect(
    repository.save({ data: loaded.data, expectedRevision: null }),
  ).rejects.toThrow(/Web Locks/);
  expect(values.size).toBe(0);
  store.setItem(STORAGE_KEY, "{bad");
  expect(await repository.original()).toBe("{bad");
  await expect(repository.load()).rejects.toThrow(/preserved/);
});
it("handles unavailable storage without enabling edits", async () => {
  const repository = new LocalWorkspaceRepository(
    {
      getItem: () => {
        throw Error("Denied");
      },
      setItem: () => {
        throw Error("Denied");
      },
    },
    null,
  );
  const controller = new WorkspaceController(repository);
  expect(await controller.load()).toBe(false);
  expect(controller.getSnapshot().loadError).toMatch(/preserved/);
  expect(await controller.save(emptyWorkspace())).toBe(false);
});
it("preserves theme, reminder and export metadata in their existing keys", () => {
  const values = new Map<string, string>();
  const preferences = new LocalPreferences({
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
  });
  expect(preferences.theme()).toBe("light");
  preferences.saveTheme("dark");
  expect(values.get("dylan-theme")).toBe("dark");
  preferences.dismiss(123);
  expect(preferences.reminder()).toBe(123);
  values.set(REMINDER_KEY, "invalid");
  expect(preferences.reminder()).toBe(0);
  const status = { requestedAt: "2026-10-08T12:00:00.000Z", content: "test" };
  preferences.recordExport(status);
  expect(preferences.exportInfo()).toEqual({
    lastExport: status.requestedAt,
    status,
  });
  preferences.confirmExport({ ...status, confirmedAt: status.requestedAt });
  expect(preferences.exportInfo().status?.confirmedAt).toBe(status.requestedAt);
  values.set(EXPORT_STATUS_KEY, "{bad");
  expect(preferences.exportInfo().status).toBeNull();
});
it("rejects out-of-order reads and a read superseded by a committed write", async () => {
  const pending: ((value: WorkspaceRead) => void)[] = [];
  const repository: WorkspaceRepository = {
    owner: { kind: "local", workspaceId: "test" },
    load: () => new Promise((resolve) => pending.push(resolve)),
    save: async ({ data }) => ({ data, revision: "saved" }),
    listSnapshots: async () => [],
    original: async () => null,
    subscribe: () => () => {},
  };
  const controller = new WorkspaceController(repository),
    one = controller.load(),
    two = controller.load();
  await Promise.resolve();
  pending[1]({
    data: { ...emptyWorkspace(), goalWeight: 160 },
    revision: "two",
  });
  expect(await two).toBe(true);
  pending[0]({
    data: { ...emptyWorkspace(), goalWeight: 170 },
    revision: "one",
  });
  expect(await one).toBe(false);
  expect(controller.getSnapshot().revision).toBe("two");
  const oldRead = controller.load();
  await Promise.resolve();
  await controller.save({ ...controller.getSnapshot().data, goalWeight: 150 });
  pending[2]({ data: emptyWorkspace(), revision: "old" });
  expect(await oldRead).toBe(false);
  expect(controller.getSnapshot().revision).toBe("saved");
});
it("subscribes to revisions and releases the subscription", async () => {
  let listener: (revision: string | null) => void = () => {},
    released = false;
  const repository: WorkspaceRepository = {
    owner: { kind: "local", workspaceId: "test" },
    load: async () => ({ data: emptyWorkspace(), revision: "current" }),
    save: async ({ data }) => ({ data, revision: "new" }),
    original: async () => null,
    listSnapshots: async () => [],
    subscribe: (f) => {
      listener = f;
      return () => {
        released = true;
      };
    },
  };
  const controller = new WorkspaceController(repository);
  await controller.load();
  const disconnect = controller.connect();
  listener("current");
  expect(controller.getSnapshot().conflict).toBe(false);
  listener("different");
  expect(controller.getSnapshot().conflict).toBe(true);
  disconnect();
  expect(released).toBe(true);
});
it("waits for an in-flight write before reloading the committed workspace", async () => {
  let live: WorkspaceRead = { data: emptyWorkspace(), revision: "old" },
    reads = 0;
  let finish: () => void = () => {};
  const repository: WorkspaceRepository = {
    owner: { kind: "local", workspaceId: "test" },
    load: async () => {
      reads++;
      return live;
    },
    save: ({ data }) =>
      new Promise((resolve) => {
        finish = () => {
          live = { data, revision: "new" };
          resolve(live);
        };
      }),
    listSnapshots: async () => [],
    original: async () => null,
    subscribe: () => () => {},
  };
  const controller = new WorkspaceController(repository);
  await controller.load();
  const writing = controller.save({ ...live.data, goalWeight: 160 }),
    reloading = controller.load();
  await Promise.resolve();
  expect(reads).toBe(1);
  finish();
  expect(await writing).toBe(true);
  expect(await reloading).toBe(true);
  expect(reads).toBe(2);
  expect(controller.getSnapshot().data.goalWeight).toBe(160);
  expect(controller.getSnapshot().revision).toBe("new");
});
