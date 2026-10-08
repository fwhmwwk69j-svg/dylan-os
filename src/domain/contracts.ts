import { isCalendarDate } from "../dates";
import type { State } from "../data";
import type { Collection } from "./collections";
export type WorkspaceOwner =
  { kind: "local"; workspaceId: string } | { kind: "account"; userId: string };
export type ScopedWorkspace = { owner: WorkspaceOwner; data: State };
export type RecordRef = { collection: Collection; id: string };
export type RecordMetadata = {
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
  source: {
    kind: "manual" | "legacy" | "integration";
    connectionId?: string;
    externalId?: string;
  };
};
export function sameOwner(a: WorkspaceOwner, b: WorkspaceOwner) {
  return (
    a.kind === b.kind &&
    (a.kind === "local" && b.kind === "local"
      ? a.workspaceId === b.workspaceId
      : a.kind === "account" && b.kind === "account" && a.userId === b.userId)
  );
}
export function assertOwner(actual: WorkspaceOwner, expected: WorkspaceOwner) {
  if (!sameOwner(actual, expected))
    throw new Error("Workspace ownership mismatch.");
}
export function resolveRecord(
  workspace: ScopedWorkspace,
  actor: WorkspaceOwner,
  ref: RecordRef,
) {
  assertOwner(workspace.owner, actor);
  const record = workspace.data[ref.collection].find((r) => r.id === ref.id);
  if (!record)
    throw new Error("Related record does not exist in this workspace.");
  return record;
}
export function assertRelationship(
  source: ScopedWorkspace,
  target: ScopedWorkspace,
  actor: WorkspaceOwner,
  from: RecordRef,
  to: RecordRef,
) {
  assertOwner(source.owner, target.owner);
  resolveRecord(source, actor, from);
  resolveRecord(target, actor, to);
  if (from.collection !== "assignments" || to.collection !== "courses")
    throw new Error("Unsupported relationship type.");
  if (
    (resolveRecord(source, actor, from) as State["assignments"][number])
      .courseId !== to.id
  )
    throw new Error("Assignment/course relationship mismatch.");
}
export function habitLogRef(habitId: string, date: string) {
  if (!habitId.trim() || !isCalendarDate(date))
    throw new Error("Invalid habit history reference.");
  return { habitId, date, id: JSON.stringify([habitId, date]) };
}
/** Ownership/revisions are storage context, never authority supplied by an imported JSON file. */
export const DOMAIN_CONTRACT = {
  portableOwnership: false,
  recordIds: "stable scoped text",
  mandatoryRelationships: ["assignments.courseId -> courses.id"],
  optionalRelationships: ["preferences.priorities.ids -> tasks.id"],
  dateUniqueCollections: ["weights", "nutrition"],
  derivedHistory: "habit ID + calendar date",
  legacyCreatedAt: null,
} as const;
