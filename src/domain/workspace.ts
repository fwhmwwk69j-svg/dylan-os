/** Storage identity is routing context, never proof of server authorization. */
export type WorkspaceIdentity =
  | { kind: "local"; workspaceId: string }
  | {
      kind: "cloud";
      environment: "staging" | "production";
      projectRef: string;
      userId: string;
    };
export function workspaceKey(identity: WorkspaceIdentity): string {
  const parts =
    identity.kind === "local"
      ? [identity.kind, identity.workspaceId]
      : [
          identity.kind,
          identity.environment,
          identity.projectRef,
          identity.userId,
        ];
  if (parts.some((part) => !part.trim()))
    throw new Error("Workspace identity fields must not be empty.");
  return JSON.stringify(parts);
}
export function sameWorkspace(a: WorkspaceIdentity, b: WorkspaceIdentity) {
  return workspaceKey(a) === workspaceKey(b);
}
