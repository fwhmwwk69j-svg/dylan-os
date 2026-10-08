import type { State } from "../data";
import type { Snapshot } from "../safety";
import type { WorkspaceOwner } from "../domain/contracts";
export type WorkspaceRead = { data: State; revision: string | null };
export type WorkspaceSave = {
  data: State;
  expectedRevision: string | null;
  reason?: string;
};
export interface WorkspaceRepository {
  readonly owner: WorkspaceOwner;
  load(): Promise<WorkspaceRead>;
  save(request: WorkspaceSave): Promise<WorkspaceRead>;
  listSnapshots(): Promise<Snapshot[]>;
  original(): Promise<string | null>;
  subscribe(listener: (revision: string | null) => void): () => void;
}
export class WorkspaceLoadError extends Error {
  constructor(
    message: string,
    readonly revision: string | null,
  ) {
    super(message);
  }
}
