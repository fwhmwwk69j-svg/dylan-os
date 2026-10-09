import type { WorkspaceIdentity } from "../domain/workspace";
export type AccountIdentity = Extract<WorkspaceIdentity, { kind: "cloud" }>;
/** Tokens/passwords are deliberately absent from observable lifecycle state. */
export type SessionState =
  | { status: "disabled" | "signed-out" | "authenticating"; generation: number }
  | {
      status: "active" | "refreshing";
      generation: number;
      account: AccountIdentity;
      expiresAt: string;
    }
  | { status: "expired"; generation: number; account: AccountIdentity };
export interface SessionLifecycle {
  getSnapshot(): SessionState;
  subscribe(listener: () => void): () => void;
  signOut(): Promise<void>;
}
export type AccountRequestContext = {
  account: AccountIdentity;
  generation: number;
};
export function isCurrentSession(
  state: SessionState,
  request: AccountRequestContext,
): boolean {
  return (
    (state.status === "active" || state.status === "refreshing") &&
    state.generation === request.generation &&
    state.account.environment === request.account.environment &&
    state.account.projectRef === request.account.projectRef &&
    state.account.userId === request.account.userId
  );
}
