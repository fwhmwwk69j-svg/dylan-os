# Future authenticated storage: migration plan

Version 1.4 stays entirely local. This document specifies a future migration; it does not enable authentication, networking, or an AI service.

## Domain and storage boundary

Keep the workspace schema, validators, calendar-date semantics, exports, and preview/confirmation flows. Introduce a repository interface for load, revision-checked save, backup, and restore before replacing localStorage. UI features should depend on that interface rather than database SDK calls. Preserve unknown fields in an extension JSON column or the original record payload.

Tasks, courses, assignments, and workouts already have stable IDs. If normalizing these into separate rows, introduce stable IDs for habits, important dates, and dated logs with an additive schema migration. Retain references and history, including habit plan effective dates, legacy completions with unknown timestamps, and dashboard preferences. Weight/nutrition must remain unique per user/calendar date; timestamps and dates must stay separate. Do not reinterpret local dates as UTC instants.

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

## Concrete Version 1.5 delivery plan

### Scope and technology

Keep the React/Vite application and current design. Use **Supabase Auth and Postgres**, with authenticated **Supabase Edge Functions** for validated workspace operations. Publish the static frontend on a host such as Vercel. This is a proposed future stack; Version 1.4 includes none of these services. Version 1.5 should add email/password sign-in, password reset, a private account workspace, revision-safe cross-device saves, cloud recovery snapshots, and explicit migration of local data. Exclude paid AI, calendar/fitness integrations, collaboration, and offline write synchronization.

Start with one JSONB workspace per user rather than normalizing every collection. Schema 5 already contains tasks, courses, school work, fitness logs/goals, habits/history, important dates, commitments/exceptions, dashboard preferences, and weekly reflections. Preserve this entire payload, including unknown fields. Do not generate commitment occurrence rows. Existing stable IDs remain unchanged; optional stable IDs for habits and dated logs can wait until normalized tables are actually needed.

### Storage and API contract

Create `workspaces(user_id primary key, payload jsonb, revision bigint, updated_at timestamptz)` and `workspace_backups(id, user_id, payload jsonb, revision, reason, created_at)`. Enable row-level security on both tables; deny anonymous access and permit users to read only their own rows. Browser roles must not write these tables or execute the privileged save transaction directly.

The Edge Function must verify the access token with the auth service, derive ownership from that verified user (never from a body field), enforce the existing 5 MB limit, and apply shared full-workspace validation. A restricted server-only database transaction locks that user's row, compares `expectedRevision`, saves the previous payload when required, writes the validated next payload, increments revision, and rotates to the latest five backups atomically. Grant this transaction only to the server role; keep its credential exclusively in server secret configuration. A stale revision returns HTTP 409 and changes neither workspace nor snapshots. An interrupted or failed transaction commits nothing.

Expose load, revision-checked save, backup-list, backup-read, and confirmed restore operations. Restore validates the selected backup and creates a backup of the destination before replacement. Clear and import use the same validated, revision-checked save path with mandatory backup. Deletion Undo remains a merge operation against the latest expected revision, with the existing expiry and collision rules. Continue JSON exports and explicit saved-file confirmation; cloud snapshots are a distinct status from external backup files.

### Implementation sequence and acceptance gates

1. **Persistence boundary:** introduce `WorkspaceRepository.load/save/listBackups/readBackup` and a local implementation around today's safety functions. Keep it as the default. Run all 1.4 tests and browser checks unchanged before adding a remote adapter.
2. **Identity and private storage:** configure the development Supabase project, migrations, RLS, server functions, and email/password flows. Test with two accounts and direct unauthorized requests. Gate: account B cannot read, write, list, export, or restore account A's workspace or snapshots; anonymous requests fail. Never commit secrets. A publishable browser key is not a substitute for authorization.
3. **Cloud adapter and conflicts:** implement the API contract. Keep tab coordination but use server revisions across devices. Retain drafts on 409 and offer an explicit reload; never silently retry a stale full-document replacement. Test two browsers saving the same revision: exactly one succeeds, with no partial changes or duplicate commitments/reflections.
4. **Explicit local migration:** require an external export first, then show source/destination previews and request upload confirmation. Account creation alone never uploads anything. If a destination exists, require an explicit replacement choice and back it up first; automatic merge is out of scope. Upload atomically, re-read, and compare records, IDs, links, histories, goals, preferences, reflection weeks, and unknown fields. Only then switch persistence mode. Preserve the original local workspace and snapshots for rollback; failed/cancelled migration leaves them unchanged.
5. **Recovery and session handling:** implement confirmed cloud restore, clear/import protections, export, account-scoped caches, and logout cleanup. Signing out must hide private workspace data and clear the active cloud cache; never display another account's or the original local workspace automatically. Keep the preserved pre-migration local copy behind explicit recovery controls. Decide and document shared-device retention before launch. Initially allow offline viewing only under the defined account/session policy and keep edits as drafts; do not queue background writes. Session expiry must preserve unsaved drafts without allowing unauthenticated saves.
6. **Staging then release:** run the complete test suite/build, real desktop/mobile auth and migration checks, unauthorized-access tests, storage/transaction failure injection, export/restore round trips, simultaneous-device writes, and logout/account-switch checks. Verify staging with synthetic data before using real data. Production activation is a separate, explicit deployment decision after provider accounts, domains, secrets, backup retention, and rollback instructions are reviewed.

Version 1.5 is complete only when the local route still works, real-data migration is opt-in and reversible, private data is isolated between users, conflicts cannot overwrite newer records, and verified cloud recovery/export paths work. Do not remove local recovery or add integrations to meet that deadline.
