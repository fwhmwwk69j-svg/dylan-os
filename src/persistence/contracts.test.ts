import { it, expect } from "vitest";
import { sameWorkspace, workspaceKey } from "../domain/workspace";
import {
  assertRevision,
  RepositoryError,
  LOCAL_CAPABILITIES,
} from "./contracts";
import { isCurrentSession } from "../auth/contracts";
it("isolates identities by kind, environment, project and account without key delimiter collisions", () => {
  const account = {
    kind: "cloud",
    environment: "staging",
    projectRef: "project",
    userId: "a",
  } as const;
  expect(sameWorkspace(account, { ...account })).toBe(true);
  for (const other of [
    { ...account, userId: "b" },
    { ...account, projectRef: "other" },
    { ...account, environment: "production" as const },
    { kind: "local" as const, workspaceId: "a" },
  ])
    expect(sameWorkspace(account, other)).toBe(false);
  expect(workspaceKey({ kind: "local", workspaceId: "a/b" })).not.toBe(
    workspaceKey(account),
  );
  expect(() => workspaceKey({ kind: "local", workspaceId: " " })).toThrow();
});
it("retains exact local bytes and rejects unsafe server revisions", () => {
  expect(() => assertRevision({ kind: "local", raw: " {raw} " })).not.toThrow();
  expect(() => assertRevision({ kind: "local", raw: null })).not.toThrow();
  for (const workspace of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() =>
      assertRevision({ kind: "cloud", workspace, records: {} }),
    ).toThrow();
  expect(() =>
    assertRevision({
      kind: "cloud",
      workspace: 2,
      records: { tasks: { a: -1 } },
    }),
  ).toThrow();
  expect(() =>
    assertRevision({
      kind: "cloud",
      workspace: 2,
      records: { tasks: { a: 1 } },
    }),
  ).not.toThrow();
});
it("rejects expired and stale-generation account requests even for the same account", () => {
  const account = {
    kind: "cloud",
    environment: "staging",
    projectRef: "project",
    userId: "a",
  } as const;
  const active = {
    status: "active",
    generation: 3,
    account,
    expiresAt: "2026-10-09T12:00:00Z",
  } as const;
  expect(isCurrentSession(active, { account, generation: 3 })).toBe(true);
  expect(isCurrentSession(active, { account, generation: 2 })).toBe(false);
  expect(
    isCurrentSession(active, {
      account: { ...account, userId: "b" },
      generation: 3,
    }),
  ).toBe(false);
  expect(
    isCurrentSession(
      { status: "expired", generation: 3, account },
      { account, generation: 3 },
    ),
  ).toBe(false);
  expect(
    isCurrentSession(
      { status: "disabled", generation: 3 },
      { account, generation: 3 },
    ),
  ).toBe(false);
});
it("distinguishes unknown commit outcomes and does not advertise unimplemented local operations", () => {
  const error = new RepositoryError(
    "outcome-unknown",
    "Check operation status",
    "unknown",
    "synthetic-operation",
  );
  expect(error.outcome).toBe("unknown");
  expect(error.operationId).toBe("synthetic-operation");
  expect(LOCAL_CAPABILITIES.atomicOperations).toBe(false);
  expect(Object.isFrozen(LOCAL_CAPABILITIES)).toBe(true);
});
