import {
  validateWorkspace,
  emptyWorkspace,
  snapshots,
  STORAGE_KEY,
  type Store,
} from "../safety";
import { coordinatedWrite } from "../crossTab";
import {
  WorkspaceLoadError,
  type WorkspaceRepository,
  type WorkspaceSave,
} from "./repository";
import { browserStore } from "./browserStore";
import { LOCAL_CAPABILITIES } from "./contracts";
import type { WorkspaceIdentity } from "../domain/workspace";
export class LocalWorkspaceRepository implements WorkspaceRepository {
  readonly capabilities = LOCAL_CAPABILITIES;
  get identity(): WorkspaceIdentity {
    return { ...this.owner };
  }
  readonly owner = { kind: "local" as const, workspaceId: STORAGE_KEY };
  constructor(
    private store: Store = browserStore,
    private locks: Pick<LockManager, "request"> | null | undefined = globalThis
      .navigator?.locks,
  ) {}
  async load() {
    const raw = this.store.getItem(STORAGE_KEY);
    try {
      return {
        data: raw ? validateWorkspace(JSON.parse(raw)) : emptyWorkspace(),
        revision: raw,
      };
    } catch {
      throw new WorkspaceLoadError(
        "Saved workspace could not be read. Your stored data has been preserved; changes are blocked until it can be restored.",
        raw,
      );
    }
  }
  async save(request: WorkspaceSave) {
    // current only supplies a fallback snapshot when storage is empty. CAS precedes every mutation.
    const data = await coordinatedWrite(
      this.store,
      emptyWorkspace(),
      request.data,
      request.expectedRevision,
      request.reason,
      this.locks,
    );
    return { data, revision: JSON.stringify(data) };
  }
  async listSnapshots() {
    return snapshots(this.store);
  }
  async original() {
    return this.store.getItem(STORAGE_KEY);
  }
  subscribe(listener: (revision: string | null) => void) {
    if (typeof window === "undefined") return () => {};
    const changed = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null)
        listener(e.key === null ? this.store.getItem(STORAGE_KEY) : e.newValue);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }
}
