import type { State } from "../data";
import type { Collection } from "../domain/collections";
import type { WorkspaceIdentity } from "../domain/workspace";
/** Local revisions remain exact stored bytes, including null for an absent workspace. */
export type LocalRevision = { kind: "local"; raw: string | null };
export type CloudRevision = {
  kind: "cloud";
  workspace: number;
  records: Partial<Record<Collection, Record<string, number>>>;
};
export type WorkspaceRevision = LocalRevision | CloudRevision;
export function assertRevision(revision: WorkspaceRevision) {
  if (revision.kind === "local") {
    if (revision.raw !== null && typeof revision.raw !== "string")
      throw new Error("Invalid local revision.");
    return;
  }
  const valid = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (
    !valid(revision.workspace) ||
    Object.values(revision.records).some((records) =>
      Object.values(records).some((n) => !valid(n)),
    )
  )
    throw new Error("Invalid cloud revision.");
}
export type RepositoryCapabilities = Readonly<{
  atomicWorkspaceSave: boolean;
  atomicOperations: boolean;
  originalBytes: boolean;
  snapshots: "local" | "account";
  offlineWrites: boolean;
  notifications: "storage-events" | "polling";
  idempotentRequests: boolean;
}>;
export const LOCAL_CAPABILITIES: RepositoryCapabilities = Object.freeze({
  atomicWorkspaceSave: true,
  atomicOperations: false,
  originalBytes: true,
  snapshots: "local",
  offlineWrites: true,
  notifications: "storage-events",
  idempotentRequests: false,
});
export type RecordMutation =
  | {
      action: "upsert";
      collection: Collection;
      record: { id: string } & Record<string, unknown>;
      expectedRecordRevision: number;
    }
  | {
      action: "delete";
      collection: Collection;
      id: string;
      expectedRecordRevision: number;
      /** Required by the server for course deletion, including an empty map. */
      expectedLinkedRevisions?: Record<string, number>;
    };
export type WorkspaceOperation =
  | RecordMutation
  | { action: "batch"; mutations: RecordMutation[] }
  | { action: "reorder"; collection: Collection; ids: string[] }
  | { action: "preferences"; preferences: NonNullable<State["preferences"]> }
  | {
      action: "goals";
      goalWeight: State["goalWeight"];
      fitnessGoals?: State["fitnessGoals"];
    }
  | {
      action: "import";
      data: State;
      sourceFingerprint: string;
      confirmation: string;
    }
  | { action: "restore"; snapshotId: string; confirmation: string }
  | { action: "clear"; confirmation: string }
  | { action: "undo"; deletionId: string };
export type OperationEnvelope = {
  workspace: WorkspaceIdentity;
  expectedRevision: WorkspaceRevision;
  operationId: string;
  operation: WorkspaceOperation;
};
export type RepositoryErrorCode =
  | "load"
  | "validation"
  | "conflict"
  | "offline"
  | "session-expired"
  | "forbidden"
  | "stale-account"
  | "quota"
  | "unavailable"
  | "outcome-unknown";
/** Unknown outcome must never be presented as proof that nothing was committed. */
export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
    readonly outcome: "not-committed" | "unknown" = "not-committed",
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
/** Future contract only: no cloud adapter is constructed or connected in Phase 1. */
export interface OperationRepository {
  readonly identity: WorkspaceIdentity;
  readonly capabilities: RepositoryCapabilities;
  load(): Promise<{ data: State; revision: WorkspaceRevision }>;
  execute(
    envelope: OperationEnvelope,
  ): Promise<{ data: State; revision: WorkspaceRevision }>;
}
