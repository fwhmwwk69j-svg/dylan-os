import type { State } from "./data";
import { persist, STORAGE_KEY, type Store } from "./safety";
export const WRITE_LOCK = "dylan-os-workspace-write";
export function checkRevision(store: Store, expected: string | null) {
  if (store.getItem(STORAGE_KEY) !== expected)
    throw new Error(
      "Workspace changed in another tab or window. Reload the latest workspace before editing.",
    );
}
export async function coordinatedWrite(
  store: Store,
  current: State,
  next: State,
  expected: string | null,
  reason?: string,
  locks: Pick<LockManager, "request"> | null | undefined = globalThis.navigator
    ?.locks,
) {
  if (!locks)
    throw new Error(
      "Safe editing requires a browser with Web Locks on HTTPS or localhost. Export remains available.",
    );
  return locks.request(WRITE_LOCK, { mode: "exclusive" }, () => {
    checkRevision(store, expected);
    return persist(store, current, next, reason);
  });
}
