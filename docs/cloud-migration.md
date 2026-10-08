# Future authenticated storage: migration plan

Version 1.3 stays entirely local. This document specifies a future migration; it does not enable authentication, networking, or an AI service.

## Domain and storage boundary

Keep the workspace schema, validators, calendar-date semantics, exports, and preview/confirmation flows. Introduce a repository interface for load, revision-checked save, backup, and restore before replacing localStorage. UI features should depend on that interface rather than database SDK calls. Preserve unknown fields in an extension JSON column or the original record payload.

Tasks, courses, assignments, and workouts already have stable IDs. Introduce stable IDs for habits, important dates, and dated logs with an additive schema migration. Retain references and history, including habit plan effective dates, legacy completions with unknown timestamps, and dashboard preferences. Weight/nutrition must remain unique per user/calendar date; timestamps and dates must stay separate. Do not reinterpret local dates as UTC instants.

## Authentication and authorization

Use an established authentication service. Every workspace, record, backup, and assistant request must be scoped to an authenticated user. Enforce ownership on the server/database, including course-linked school work; a client-provided user ID is insufficient. Test access between two distinct accounts before migrating real data. Keep all service secrets and future AI API keys on the server. Do not store credentials in exported workspace JSON.

## Transactional writes and conflicts

Assign each workspace a server-generated revision. Save only when the expected revision matches, using a transaction or compare-and-swap. Return a conflict without changing records if it differs. Keep the local revision warning/reload experience and draft preservation. Web Locks coordinate one browser origin today; they cannot coordinate different devices or server writes.

Start with one workspace document per user if it keeps backups and atomic replacement simple. Move to normalized tables only for demonstrated query needs. Imports, course cascade deletion, Undo, and restore must update related records atomically, with the previous version backed up first. Apply existing validators server-side and bound request/backup sizes.

## Opt-in rollout and recovery

1. Ship and test the repository boundary against the existing local store first.
2. Ask the user to export and verify a backup file before migration. Keep the original local workspace and snapshots intact.
3. Sign in, then explicitly preview and approve the workspace upload. Account creation alone must never upload local records.
4. Validate, assign missing IDs additively, and create the user workspace in one transaction. Re-read it and compare counts, relationships, histories, preferences, and extension fields.
5. If the account already has data, show an explicit choice with previews; never silently merge or replace it. Back up the destination before confirmed replacement.
6. Switch to cloud storage only after verified success. Failed or cancelled migrations leave local storage usable. Provide JSON export, revisioned backups, rollback, and a local recovery route.

Define offline behavior separately. Initially, show offline read-only data and retain unsaved drafts rather than inventing a background sync queue. Adding offline write reconciliation requires an explicit conflict policy and additional tests. Document account deletion, retention, logout/device behavior, and recovery before deployment.

## Acceptance gate

Test two-user authorization, simultaneous device saves, invalid imports, interrupted migration, ID/reference preservation, original local rollback, offline drafts, expired sessions, backup rotation/restore, and full export round trips. Keep paid AI and external calendar/health integrations as separate releases after ownership and recovery guarantees are proven.
