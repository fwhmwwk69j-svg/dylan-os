# Proposed relational schema — design only

This document is a proposed PostgreSQL/Supabase schema, **not an applied migration**. No database, auth client, API or cloud resource is created by Version 1.5.1. Final DDL/RLS/transaction functions belong to separately approved 1.5.2 staging work.

## Common rules

Every private domain table has `user_id uuid` from verified authentication, `id text` for portable record identity, `revision bigint`, nullable historical `created_at`/`updated_at`, source metadata and `extensions jsonb`. Use `(user_id, id)` as the primary or unique key; do not cast preserved legacy text IDs into UUIDs. New IDs can be UUID strings. Every relationship includes `user_id` on both sides. Owner IDs, entitlement state, consent, credentials and storage revision are not imported from portable JSON.

Future new writes use server timestamps; unknown legacy timestamps remain NULL. JSONB extensions preserve unknown properties including nested fields without turning them into permissions. Workspace-level unknown fields have their own extensions document. Prefer explicit columns for relationships, dates, amounts and queryable metrics. Portable reconstruction must reproduce all supported fields and extensions, including optional/absent-value conventions needed by export validators.

## Current-domain tables

| Table                   | Main columns / constraints                                                                                                                                 | Domain                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `account_workspaces`    | `user_id` PK, server `revision`, portable schema version, extensions; transaction lock target                                                              | Platform                             |
| `workspace_preferences` | `user_id` PK/FK, dashboard ordering/visibility/task-priority JSONB, future timezone preference                                                             | Platform; visibility is presentation |
| `tasks`                 | owner/id, name, category, priority, `due date`, completed, nullable completion date, recurring flag                                                        | Life & Goals                         |
| `courses`               | owner/id, name, code, instructor, nullable manually entered grade, notes                                                                                   | College                              |
| `school_work`           | owner/id, `course_id`, assignment/exam kind, name, `due date`, completed/date, nullable grade, notes; FK `(user_id, course_id)` → courses                  | College                              |
| `weight_entries`        | owner/id, `date date`, numeric weight; UNIQUE `(user_id, date)`                                                                                            | Health                               |
| `daily_nutrition`       | owner/id, `date date`, calories, protein, steps; UNIQUE `(user_id, date)`                                                                                  | Health                               |
| `workout_entries`       | owner/id, date, session name, exercise, weight, reps, sets, completed; preserve current multiple exercise rows/session                                     | Health                               |
| `fitness_goals`         | `user_id` PK/FK, goal weight, calories, protein, steps, weekly workouts, extensions; absent/unset distinct from zero                                       | Health                               |
| `habits`                | owner/id, name, creation calendar date, target and schedule; name is not identity                                                                          | Life & Goals                         |
| `habit_plan_history`    | owner/habit/effective date, target, weekday set; composite FK to habits; preserve effective-date semantics                                                 | Life & Goals                         |
| `habit_completions`     | owner/habit/date key, count, historical completion marker; preserve legacy `dates`, `counts`, schedule history and unknown nested fields on reconstruction | Life & Goals                         |
| `important_dates`       | owner/id, name, date; duplicate names/dates allowed if IDs differ                                                                                          | Life & Goals                         |
| `commitment_series`     | owner/id, kind, name, weekday set, local start/end time, inclusive start/end dates; current floating-local mode                                            | Life & Goals / Scheduling            |
| `commitment_exceptions` | owner/series/date key, composite FK to series; no persisted occurrence copies                                                                              | Scheduling                           |
| `weekly_reflections`    | owner/id, Monday-start review date, reflection text, exactly three following-week priorities; UNIQUE owner/week                                            | Life & Goals                         |
| `workspace_snapshots`   | owner/id, portable payload JSONB or exact original raw text, revision, reason, schema/version, timestamp, integrity metadata                               | Platform recovery                    |

Protect source relationships before applying course deletions. User-confirmed deletion removes linked school work in the same transaction; the destination snapshot and short-lived Undo information permit restoration without resetting IDs. Reject unexpected dangling required references. Optional chosen task priorities may refer to deleted tasks; filter them in views rather than silently editing imported unknown payloads.

Dates/schedules retain present semantics. Habit logs use a composite natural key; don't invent a new ID for every completion or load. Avoid speculative workout-session regrouping in cloud migration: current sessions are derived from date/name and existing records must not be conflated. Fitness goal weight has one authority; reconstruct legacy `goalWeight` consistently.

## Shared scheduling and future module relationships

Future `calendars`, `calendar_memberships` and `calendar_events` support narrow shared event visibility. Keep a creator/owner and per-calendar membership with explicit roles. Private health/academic/finance data is not made public by a calendar link. Shared events may contain a sanitized display copy; retrieving the source record separately requires its owner-scoped authorization. RLS must check membership and allowed event fields, not grant access to the whole owner's workspace.

Future fixed events use `starts_at/ends_at timestamptz`, an IANA zone, and an explicit wall-time/DST conversion policy. Recurring series retain rule/exception identity; derived occurrence keys do not become duplicated task/assignment rows. Typed cross-module links use owner-scoped link tables with actual FKs (e.g. event-to-school-work) where possible. Avoid unconstrained polymorphic foreign keys that permit links to someone else's record. Add financial, journal, document and relationship tables only with their approved features.

## Future platform tables

- `account_settings` / lifecycle status: profile preferences, module customization, zone, deletion state and policy versions; account owner derives from verified Auth.
- `ai_consents`: owner, scope, bounded purpose, granted/revoked timestamps and revision; independent of module visibility and subscription plan. `ai_requests` stores minimal operational metadata, not unrestricted personal prompts/context. Approval records for AI actions bind command, expected revision and user confirmation.
- `integration_connections`: owner, provider and secret reference, narrow granted scopes, revocation and cursor; encrypted tokens in server-controlled secret storage. `external_record_links`: owner, connection, provider object identity UNIQUE for idempotent ingestion.
- `subscription_entitlements`: provider/customer/subscription references, effective server-verified feature grants and expiry. `billing_events`: unique provider event IDs. `usage_reservations`: unique account/request ID and reserved/settled/released units; transactions prevent double charging. No imported fields grant access.
- `deletion_jobs`: account lifecycle, revocation progress, record/file purge and backup-expiry deadlines; minimized audit. Deletion policy covers integrations, shared memberships, billing/legal retention and provider backups.
- Private object storage for future documents has owner-prefixed keys plus enforced access policies, signed short-lived retrieval and a server-controlled metadata table. A public bucket is unsuitable for academic/health/financial files.

## Transaction and RLS acceptance requirements

Deny anonymous operations. RLS scopes every private read to verified account ownership; write paths may be restricted to authenticated server commands if needed for atomic multi-table behavior. Privileged functions validate the session, owner, schema, relationships and expected revision independently of RLS; service-role access is never sent to the browser.

A save transaction locks `account_workspaces`, checks revision, captures a reconstructable previous snapshot for destructive operations, changes domain rows and increments revision. Snapshot rotation, import/restore/clear and linked deletions are atomic. Any validation/quota/storage error rolls back everything. Server revisions coordinate devices; local raw-string revisions and Web Locks do not.

Before real migration, test all two-user/anonymous read/write/list/export/restore cases, cross-owner FK violations, shared-calendar permission boundaries, deleted-account denial, expired sessions, simultaneous writes, transaction failures and full JSON round trips including unknown nested fields. Record export/import preservation and exact-original snapshot handling must pass against representative schemas 1–6.
