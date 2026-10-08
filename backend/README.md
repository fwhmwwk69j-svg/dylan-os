# Staging-only backend boundary

The server implementation is PostgreSQL RPC in `supabase/migrations`, behind Supabase Auth/PostgREST. No privileged Edge Function or service-role browser client is needed. Browser users receive SELECT-only own-account access to domain tables; only the authenticated RPC transaction mutates them. RPCs derive the actor from verified JWT claims and check the administrator-managed staging allowlist and live Auth session.

- `dylan_read()` → `{ data, revision, recordRevisions }`, including a blank synthetic workspace at revision zero.
- `dylan_export()` → portable schema-6 JSON plus export timestamp, for the caller only.
- `dylan_command(command)` → validated upsert/delete/preferences/goals/confirmed snapshot restore. Requires expected workspace revision and, for record changes, expected record revision. Owner and permission inputs are rejected. Successful commands advance the workspace and affected record revision; stale commands return HTTP 409 (`PT409`) without changes. Do not use SQLSTATE 40001 for application conflicts: PostgREST may retry serialization errors.
- Snapshot listing/read uses own-account SELECT on `workspace_snapshots`. Every command snapshots the previous workspace in the same transaction; the newest five are retained. Restore captures the selected snapshot before rotation, snapshots the destination, reconstructs relational rows and advances revisions.

`src/persistence/staging/client.ts` is an isolated test harness; App never imports it or creates it. It accepts explicitly staging/synthetic configuration and a publishable key. Sign-in uses Auth password login for administrator-created accounts; there is no signup method. Tokens/cache remain memory-only, outgoing requests omit cookies and use `no-store`, account changes clear caches and abort outstanding requests, and late responses are discarded. Bearer subject and session user must match before binding a memory cache; this client-side consistency guard does not authenticate the token. Account IDs used locally do not authorize database commands. Logout clears memory immediately even when server revocation fails. No workspace import/upload method exists.

Client abort cannot undo a server transaction already committed under the previous account. Such a transaction remains scoped to that account; discard its result and reload after signing back in. Hosted logout/session timing must be tested with real Auth before any real-data release. No session restoration, background refresh, browser/cloud offline caching or UI account selector is enabled in 1.5.2.

Collection ownership:

| Portable collection | Relational table   | Owner/domain                           |
| ------------------- | ------------------ | -------------------------------------- |
| tasks               | tasks              | account / Life & Goals                 |
| courses             | courses            | account / College                      |
| assignments/exams   | school_work        | account / College; composite course FK |
| weights             | weight_entries     | account / Health; unique owner/date    |
| nutrition/steps     | daily_nutrition    | account / Health; unique owner/date    |
| workouts            | workout_entries    | account / Health                       |
| habits              | habits             | account / Life & Goals                 |
| important dates     | important_dates    | account / Life & Goals                 |
| commitments         | commitment_series  | account / Life & Goals / Scheduling    |
| reflections         | weekly_reflections | account / Life & Goals                 |

Queryable scalar fields live in typed columns. Habit counts/plan history and preferences remain JSONB; weekdays, completion dates and recurrence exceptions are arrays. They are nested owned configuration/history, not an opaque workspace document. No commitment occurrence copies are stored. Workspace-level extensions have a separate owned JSONB field reserved for the later explicit import. No current command bulk-populates it. Unknown record fields live in `extensions`; `present_fields` preserves omitted optional fields in exports. Fitness goals are separately owned rows. Database revisions never come from imported record metadata; no import is supported yet. The proposed separate habit-history/exception tables remain a later normalization option rather than duplicating current history in multiple sources.

The quarantine Storage bucket is private and has a restrictive deny policy for browser roles. No document upload/download functionality is activated. A service administrator can still bypass RLS; privileged credentials must remain exclusively in secure operator/CI environments.

Staging exports currently order relational collections by ID. Version 1.5.3 must implement and verify original array ordering as part of its explicit migration rather than guessing or discarding it. Current local data/order are untouched. Staging request/record size caps and ID length constraints must be included in migration previews and tested against representative exports before accepting real records.
