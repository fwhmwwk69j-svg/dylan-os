import { describe, it, expect } from "vitest";
import { coordinatedWrite, checkRevision } from "./crossTab";
import { emptyWorkspace } from "./personal";
import { STORAGE_KEY, snapshots } from "./safety";
function fixture() {
  const state = emptyWorkspace();
  const raw = JSON.stringify(state);
  const values = new Map([[STORAGE_KEY, raw]]);
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  let tail = Promise.resolve();
  const locks = {
    request: (_name: unknown, _options: unknown, callback: () => unknown) => {
      const work = tail.then(callback);
      tail = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
  } as unknown as Pick<LockManager, "request">;
  return { state, raw, store, locks };
}
describe("cross-tab coordinated writes", () => {
  it("serializes simultaneous editors so only one can commit the same revision", async () => {
    const { state, raw, store, locks } = fixture();
    const result = await Promise.allSettled([
      coordinatedWrite(
        store,
        state,
        { ...state, goalWeight: 150 },
        raw,
        "Edit goal",
        locks,
      ),
      coordinatedWrite(
        store,
        state,
        { ...state, goalWeight: 160 },
        raw,
        "Edit goal",
        locks,
      ),
    ]);
    expect(result.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(JSON.parse(store.getItem(STORAGE_KEY)!).goalWeight).toBe(150);
    expect(snapshots(store)).toHaveLength(1);
  });
  it("rejects stale edits without writing records or snapshots", async () => {
    const { state, raw, store, locks } = fixture();
    store.setItem(STORAGE_KEY, JSON.stringify({ ...state, goalWeight: 170 }));
    expect(() => checkRevision(store, raw)).toThrow(/Reload/);
    await expect(
      coordinatedWrite(
        store,
        state,
        { ...state, goalWeight: 160 },
        raw,
        "Edit",
        locks,
      ),
    ).rejects.toThrow(/another tab/);
    expect(snapshots(store)).toHaveLength(0);
    expect(JSON.parse(store.getItem(STORAGE_KEY)!).goalWeight).toBe(170);
  });
  it("allows explicit reload followed by a fresh edit, preserving newer records", async () => {
    const { state, raw, store, locks } = fixture();
    await coordinatedWrite(
      store,
      state,
      { ...state, goalWeight: 150 },
      raw,
      undefined,
      locks,
    );
    const revision = store.getItem(STORAGE_KEY);
    const latest = JSON.parse(revision!);
    await coordinatedWrite(
      store,
      latest,
      {
        ...latest,
        weights: [{ id: "new-weight", date: "2026-10-08", value: 180 }],
      },
      revision,
      undefined,
      locks,
    );
    expect(JSON.parse(store.getItem(STORAGE_KEY)!)).toMatchObject({
      goalWeight: 150,
      weights: [{ value: 180 }],
    });
  });
  it("blocks unsafe writing when Web Locks is unavailable", async () => {
    const { state, raw, store } = fixture();
    await expect(
      coordinatedWrite(
        store,
        state,
        { ...state, goalWeight: 150 },
        raw,
        undefined,
        null,
      ),
    ).rejects.toThrow(/Web Locks/);
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
  });
});
