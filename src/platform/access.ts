import type { Collection } from "../domain/collections";
import {
  assertOwner,
  type ScopedWorkspace,
  type WorkspaceOwner,
} from "../domain/contracts";
export const AI_SCOPES = {
  "college.records": ["courses", "assignments"],
  "health.logs": ["weights", "nutrition", "workouts"],
  "life.tasks": ["tasks"],
  "life.habits": ["habits"],
  "life.reflections": ["weeklyReflections"],
  "calendar.events": ["commitments", "dates"],
  "library.documents": [],
  "finances.records": [],
} as const satisfies Record<string, readonly Collection[]>;
export type AiScope = keyof typeof AI_SCOPES;
export type AiGrant = { owner: WorkspaceOwner; scopes: readonly AiScope[] };
/** Inactive future contract: no model, API, billing, or automatic grants. */
export function selectAiContext(
  workspace: ScopedWorkspace,
  actor: WorkspaceOwner,
  grant: AiGrant,
  requested: readonly AiScope[],
) {
  assertOwner(workspace.owner, actor);
  assertOwner(grant.owner, actor);
  const context: Partial<Record<Collection, unknown[]>> = {};
  for (const scope of requested) {
    if (!Object.hasOwn(AI_SCOPES, scope) || !grant.scopes.includes(scope))
      throw new Error("AI scope is not granted.");
    for (const key of AI_SCOPES[scope])
      context[key] = workspace.data[key].map((record) => {
        // No unrestricted notes or unknown extension fields enter context by default.
        const keys =
          key === "courses"
            ? ["id", "name", "code", "grade"]
            : key === "assignments"
              ? ["id", "name", "courseId", "due", "type", "completed", "grade"]
              : key === "weights"
                ? ["id", "date", "value"]
                : key === "nutrition"
                  ? ["id", "date", "calories", "protein", "steps"]
                  : key === "workouts"
                    ? [
                        "id",
                        "date",
                        "name",
                        "exercise",
                        "weight",
                        "reps",
                        "sets",
                        "completed",
                      ]
                    : key === "tasks"
                      ? [
                          "id",
                          "name",
                          "due",
                          "priority",
                          "category",
                          "completed",
                        ]
                      : key === "habits"
                        ? [
                            "id",
                            "name",
                            "dates",
                            "counts",
                            "schedule",
                            "scheduleHistory",
                            "target",
                            "createdOn",
                          ]
                        : key === "weeklyReflections"
                          ? ["id", "weekStart", "reflection", "priorities"]
                          : key === "commitments"
                            ? [
                                "id",
                                "name",
                                "kind",
                                "days",
                                "startTime",
                                "endTime",
                                "startsOn",
                                "endsOn",
                                "exceptions",
                              ]
                            : ["id", "name", "date"];
        return Object.fromEntries(
          keys
            .filter((k) => Object.hasOwn(record, k))
            .map((k) => [k, (record as unknown as Record<string, unknown>)[k]]),
        );
      });
  }
  return structuredClone(context);
}
export type EntitlementFeature =
  | "core.manual"
  | "data.export"
  | "data.delete"
  | "ai.analysis"
  | "integrations.premium";
export type ServerEntitlements = {
  subject: string;
  revision: number;
  features: readonly EntitlementFeature[];
  expiresAt: string;
};
export type UsageReservation = {
  requestId: string;
  subject: string;
  feature: EntitlementFeature;
  units: number;
  state: "reserved" | "settled" | "released";
};
export const ACCESS_CONTRACT = {
  active: false,
  denyAiByDefault: true,
  moduleVisibilityIsPermission: false,
  entitlementIsAiConsent: false,
  importsGrantAuthority: false,
  serverVerificationRequired: true,
  financialTransactionsEnabled: false,
  mutationsRequireConfirmation: true,
  alwaysAvailable: ["data.export", "data.delete"],
} as const;
