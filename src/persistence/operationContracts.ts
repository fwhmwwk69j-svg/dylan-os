import type { State } from "../data";
import type { CloudRevision, RecordMutation } from "./contracts";
import type { Collection } from "../domain/collections";
/** Wire contract only. No fetch, authentication, adapter construction or UI connection. */
export type AtomicOperation =
  | RecordMutation
  | { action: "batch"; mutations: RecordMutation[] }
  | { action: "reorder"; collection: Collection; ids: string[] }
  | { action: "preferences"; preferences: NonNullable<State["preferences"]> }
  | {
      action: "goals";
      goals: {
        goalWeight: State["goalWeight"];
        fitnessGoals?: State["fitnessGoals"];
      };
    }
  | { action: "undo"; deletionId: string };
export type AtomicRequest = {
  version: 1;
  operationId: string;
  expectedRevision: number;
  operation: AtomicOperation;
};
export type OperationReceipt = {
  operationId: string;
  committedRevision: number;
  kind: AtomicOperation["action"];
  deletionId: string | null;
  committedAt: string;
};
export type OperationResult = {
  receipt: OperationReceipt;
  workspace: {
    data: State;
    revision: CloudRevision["workspace"];
    recordRevisions: CloudRevision["records"];
  };
  replayed: boolean;
};
export type OperationStatus =
  | { status: "committed"; receipt: OperationReceipt }
  | { status: "not-found" | "expired" };
export const ATOMIC_LIMITS = Object.freeze({
  batchMutations: 100,
  requestBytes: 262144,
  undoSeconds: 30,
  admissionHours: 24,
  futureSkewMinutes: 5,
  receiptRetentionDays: 7,
});
