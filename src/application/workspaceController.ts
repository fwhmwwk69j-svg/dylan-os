import type { State } from "../data";
import {
  emptyWorkspace,
  deletion,
  undoDeletion,
  type Deletion,
} from "../safety";
import { clearCommand } from "./commands";
import {
  WorkspaceLoadError,
  type WorkspaceRepository,
} from "../persistence/repository";
import { RevisionConflictError } from "../crossTab";
export type WorkspaceView = {
  data: State;
  revision: string | null;
  ready: boolean;
  loadError: string;
  notice: string;
  conflict: boolean;
  undo: Deletion | null;
};
export class WorkspaceController {
  private view: WorkspaceView = {
    data: emptyWorkspace(),
    revision: null,
    ready: false,
    loadError: "",
    notice: "",
    conflict: false,
    undo: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pendingWrites = new Set<Promise<unknown>>();
  constructor(readonly repository: WorkspaceRepository) {}
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(value: Partial<WorkspaceView>) {
    this.view = { ...this.view, ...value };
    for (const listener of this.listeners) listener();
  }
  setNotice = (notice: string) => this.patch({ notice });
  async load() {
    // A reload must observe completed commands, never race a pending repository write.
    await Promise.allSettled([...this.pendingWrites]);
    const generation = ++this.generation;
    try {
      const loaded = await this.repository.load();
      if (generation !== this.generation) return false;
      this.patch({
        ...loaded,
        ready: true,
        loadError: "",
        notice: "",
        conflict: false,
        undo: null,
      });
      return true;
    } catch (e) {
      if (generation !== this.generation) return false;
      const message =
        e instanceof WorkspaceLoadError
          ? e.message
          : "Saved workspace could not be read. Your stored data has been preserved; changes are blocked until it can be restored.";
      this.patch({
        ready: true,
        revision: e instanceof WorkspaceLoadError ? e.revision : null,
        loadError: message,
        notice: message,
      });
      return false;
    }
  }
  connect() {
    return this.repository.subscribe((revision) => {
      if (revision !== this.view.revision) this.patch({ conflict: true });
    });
  }
  async save(
    data: State,
    reason?: string,
    recovery = false,
    expectedRevision = this.view.revision,
  ) {
    if (!this.view.ready) return false;
    if (this.view.loadError && !recovery) {
      this.patch({ notice: this.view.loadError });
      return false;
    }
    try {
      if (expectedRevision !== this.view.revision)
        throw new RevisionConflictError();
      const writing = this.repository.save({ data, reason, expectedRevision });
      this.pendingWrites.add(writing);
      let saved;
      try {
        saved = await writing;
      } finally {
        this.pendingWrites.delete(writing);
      }
      ++this.generation; // Invalidate any older in-flight read before accepting this committed revision.
      this.patch({ ...saved, loadError: "", notice: "" });
      return true;
    } catch (e) {
      this.patch({
        notice: `Nothing was changed: ${(e as Error).message}`,
        ...(e instanceof RevisionConflictError ? { conflict: true } : {}),
      });
      return false;
    }
  }
  async remove(
    next: State,
    label: string,
    expectedRevision = this.view.revision,
  ) {
    const entry = deletion(this.view.data, next, label);
    if (
      await this.save(next, `Before deleting ${label}`, false, expectedRevision)
    ) {
      this.patch({ undo: entry });
      return true;
    }
    return false;
  }
  async undoLast(expectedRevision = this.view.revision) {
    if (!this.view.undo) return false;
    try {
      const next = undoDeletion(this.view.data, this.view.undo);
      if (
        await this.save(
          next,
          `Before undoing ${this.view.undo.label}`,
          false,
          expectedRevision,
        )
      ) {
        this.patch({ undo: null });
        return true;
      }
    } catch (e) {
      this.patch({ notice: (e as Error).message });
    }
    return false;
  }
  dismissUndo = () => this.patch({ undo: null });
  async clear(confirmation: string, expectedRevision = this.view.revision) {
    try {
      const cleared = await this.save(
        clearCommand(confirmation),
        "Before clearing workspace",
        true,
        expectedRevision,
      );
      if (cleared) this.dismissUndo();
      return cleared;
    } catch (e) {
      this.patch({ notice: (e as Error).message });
      return false;
    }
  }
}
