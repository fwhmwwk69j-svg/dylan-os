# Dylan OS

A personal operating system for a more intentional day. Version 1.5.1 is a responsive React + TypeScript application with a calm green design, light and dark modes, and a personal workspace that starts empty. Existing Version 1, 1.1, 1.2, 1.3, and 1.4 records are preserved.

## Run locally

Use Node.js 24 LTS and npm (version pin in `.nvmrc`).

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Production assets can be hosted on any static web host:

```sh
npm run build
npm run preview
```

```sh
npm test          # connected data, recurrence, averages, assistant context
npm run format   # format source and configuration
```

## Current workflow

- **Today:** overdue tasks first, due-today tasks, separate upcoming assignments and exams (next 14 days plus all overdue work), today's workout, editable daily habits, weight progress, editable important dates, and quick add. Urgency labels distinguish overdue, today, tomorrow, and the next three days. The dashboard refreshes its date when left open overnight.
- **College:** add your real courses, edit their details, leave grades blank until known, and maintain course notes. Add/edit/delete assignments and exams with optional recorded grades and notes. Open a course and choose **Edit course** to replace old demo details; **Delete course** confirms removal of the course and its linked school work. Existing courses are never silently deleted.
- **Fitness:** log weights, an optional goal, calories/protein/steps by date, and planned or completed workouts. Existing charts, exercise history, and personal records remain. Each workout entry records an exercise, weight, reps, and set count (older records default to one set); multiple completed entries with the same workout name/date count as one session.
- **Tasks:** add/edit/delete, categories, priorities, due dates, completion, daily recurrence, and overdue filtering. Completing an overdue recurring task schedules its next occurrence for tomorrow rather than creating more overdue copies.
- **Quick add:** the plus button is available on every page; Today also has a labeled Quick add button. Add a task, assignment, exam, weight entry, workout, or habit check-in. If no courses exist, adding school work first opens a course form and then returns to the assignment/exam form. Add/edit habits from Today; habit check-ins can be backdated to days when the habit existed.
- **Weekly review:** open **Weekly review** from Today. The last seven calendar days summarize tasks and school work by actual completion date, pending school workload including overdue work, first-to-last weight change, workout sessions, average steps across logged days, and habit consistency. Missing weights/steps show an empty state. New habits count only from creation; older habits have no known creation date and count across the full seven-day window.
- **AI Assistant:** a labeled, deterministic local preview that reads workspace data. No AI model, external API, billing, or data transmission is implemented; the weekly-review prompt shares the new review calculations.

All edits use the same browser `localStorage` key (`dylan-os-v1`), with theme under `dylan-theme`. Migration is additive and preserves Version 1 records. Existing completed tasks/assignments without a completion date remain completed, but are excluded from weekly counts and called out as undated. Completing or reopening records updates their completion date going forward. Course/assignment edits preserve these dates. A malformed saved workspace is retained and protected from accidental replacement.

New browsers start with no fabricated courses, deadlines, workouts, weight, nutrition, or habits. The sample fixture remains only for automated tests. Clearing site data deletes the workspace; data is specific to the browser/origin and is not automatically backed up off-device or synchronized. No authentication or database is connected.

## Data safety and recovery (Version 1.2)

Open **Data & Backup** in the sidebar or mobile navigation.

1. **Export workspace** downloads `dylan-os-backup-YYYY-MM-DD.json`. It contains the full workspace, schema version 5, and an ISO export timestamp, including unknown fields. Store this file outside the browser. The page tracks when a download was requested; browsers cannot confirm that the file was saved.
2. **Import workspace** accepts JSON exports and legacy raw workspace JSON (schemas 1, 2, 3, 4, and 5, including unversioned V1 data). Files are limited to 5 MB. The validator checks every collection and record, field types, real calendar dates, numeric ranges, IDs, duplicate dated logs, course links, and supported schema versions. Invalid files do not write anything. Valid files show a count preview; checking the replacement acknowledgment and pressing **Confirm replacement** are both required.
3. **Local snapshots** preserve the exact previous stored JSON before imports, restores, clearing, deletions, and saved record edits. Course notes save after a short pause or on blur, with a snapshot before each saved correction. Only the five newest snapshots are kept. **Restore backup** goes through validation, preview, and confirmation, then snapshots the workspace it replaces. Original snapshot JSON can also be downloaded.
4. **Undo deletion** is available for 30 seconds after the latest task, course, assignment/exam, workout, habit, or important-date deletion. Course Undo restores linked school work too. Undo merges deleted records into current data instead of rolling back edits made afterward; it refuses conflicting IDs/records. Older deletions can be recovered through retained snapshots, which replace the whole workspace after confirmation.
5. **Clear workspace** requires opening the clear controls, typing `CLEAR MY WORKSPACE` exactly, and pressing the final confirmation. A snapshot must be saved immediately beforehand. Theme, export status, and existing snapshots remain.

Workspace writes are committed to the UI only after storage succeeds. If snapshot creation fails (for example, storage is full), the destructive operation is blocked. If the final workspace write fails, the old workspace and the newly created recovery snapshot remain. Corrupt or unsupported saved workspace data is not silently reset: ordinary edits are blocked, original data can be downloaded, and a validated replacement can be confirmed explicitly. Unknown workspace and nested record fields survive loading, export/import, edits, and Undo; known schema versions migrate additively to 5.

Storage keys: `dylan-os-v1` (workspace, unchanged), `dylan-os-backups-v1` (snapshots), `dylan-os-last-export` (last export request), and `dylan-theme` (theme). Local snapshots are not off-device backups. Clearing browser site data or losing the device also loses those snapshots.

## Personal reliability (Version 1.3)

- **Multiple tabs:** a presence notice identifies other open tabs. Web Locks serialize workspace writes, and an exact stored-revision check rejects stale changes before creating snapshots or replacing data. Conflicting tabs retain their current view and form drafts; **Reload latest workspace** explicitly loads the newer data. A dialog warns before discarding an open form or course notes. Safe editing requires Web Locks on HTTPS or localhost; unsupported browsers can still export.
- **Historical corrections:** Fitness now lists weight and nutrition/steps entries with Edit/Delete. Correct exercise, sets, reps, weight, date, or workout status from exercise history. Corrections update charts and reviews immediately, preserve extension fields, and snapshot the previous state. Weight/nutrition deletions also offer the existing 30-second Undo.
- **Today preferences:** choose **Customize Today** to show/hide or reorder the nine cards and select up to three unfinished tasks as today's priorities, including future tasks. Preferences persist and travel in exports. Daily priorities expire at the next local calendar day; overdue work remains in its own section. The daily overview shows school work, workout sets, and scheduled habits.
- **Habits:** edit daily target and weekdays from Today. Use +1 for incremental progress or the checkbox to complete/reset the target. History shows counts, targets, scheduled-day streaks, and weekly percentages. Choose a history ending date to inspect older records. Rest days and days before creation are excluded from completion opportunities. Schedule changes apply from today and preserve earlier plans; legacy completion dates remain one recorded completion each.
- **Backup reminders:** an unobtrusive reminder appears when no saved-file confirmation exists or the last one is at least seven days old. Dismiss it for 24 hours. Data & Backup compares the current workspace with the last exported content. A download request never claims an external backup exists: explicitly choose **I saved the backup file** after keeping the downloaded file. This is a user confirmation, not file-system verification. Metadata uses `dylan-os-export-status-v1` and dismissal uses `dylan-os-backup-reminder-v1`; workspace and snapshot keys stay unchanged.

Version 1.3 introduced schema **4**; Version 1.4 migrates it additively to **5**. All supported older schemas load additively; optional workout sets, habit plans/counts, and preferences do not invalidate legacy data. Imports and exports carry these new fields along with unknown extensions. No authentication, cloud database, external integration, or paid AI has been added.

See [the authenticated storage migration plan](docs/cloud-migration.md) for the exact proposed repository boundary, stable-ID migration, server authorization, revision handling, opt-in upload, and rollback requirements.

## Core planning (Version 1.4)

- **Weekly Planner:** the sidebar now includes a seven-day view, initially starting today. Change the start date or move backward/forward by seven days. It connects existing task due dates, assignments, exams, workout entries, scheduled habits, important dates, and recurring commitments. Click a task, school item, or workout to edit the original record; Today and other pages update from that same workspace. Future habit completions are disabled; past/today check-ins use historical targets and snapshots. Overdue work stays visible above the range. Use the existing Quick add button to create new records and choose their dates.
- **Recurring commitments:** add or edit a class, work shift, or personal activity with weekday(s), same-day start/end times, an inclusive start/end date range, and skip dates. The planner derives occurrences without saving copies; edits update the series, and exception dates remove only those occurrences. Duplicate IDs, repeated weekdays, repeated exceptions, and identical series definitions are rejected. Split overnight shifts into two entries. Deletions take snapshots and offer Undo. Skipped occurrences can be restored by removing their date from the exception list.
- **Fitness goals:** configure weight, daily calories/protein/steps, and weekly workouts on Fitness; blank removes a goal. Goals are displayed on Fitness and Today alongside actual logs. Missing logs are labeled as missing. Workout progress counts distinct completed date/name sessions in the Monday–Sunday week, excluding future logs; sets/exercises in one session do not inflate the count. The existing seven-day trend/review calculations still use their original rolling window. The weight goal shares the existing `goalWeight` field.
- **Saved reflections:** Weekly review now lets you choose a Monday-start review week, save a reflection and exactly three distinct priorities for the following Monday–Sunday week, and reopen older reflections. Saving again updates the same week rather than creating a duplicate. Delete/Undo and snapshots are supported. The priorities appear on Today and each applicable planner day; they are intentions, not duplicated task records. Daily top-three task selections remain separate.
- **Today integration:** today's recurring commitments and this week's reflection priorities appear in **Your week, today**, with a link to the planner. Fitness goals use the same live logs as Fitness. The original cards, urgency, customization, local persistence, and quick-add controls remain.
- **Backup compatibility:** schema **5** adds `commitments`, `weeklyReflections`, and optional `fitnessGoals`. Legacy schemas 1–4 receive empty new collections without altering their original records or unknown fields. Schema 5 imports require both new collections; invalid schedules, goal ranges, reflection dates/priorities, or duplicates are rejected before storage changes. JSON exports, import previews, restore, local snapshot rotation, guarded clearing, and Undo cover the new data too. All writes use the existing Web Locks and revision checks. Reloading after a conflict also resets the new inline forms after confirmation.

No visual redesign, authentication, cloud service, paid AI, or external integration was added.

## Version 1.5.1: local architecture preparation

The interface and existing workflows remain unchanged. Persistence is behind an asynchronous local repository, and application commands/recovery are separated from React rendering. Schema **6** adds stable IDs to habits, important dates and weight/nutrition logs while preserving existing IDs, references, unknown fields and completion histories. Loading/exporting does not rewrite saved data. The first successful edit snapshots the original legacy bytes before saving migrated data; repeated migrations produce identical identities and no duplicate records. Old schema 1–5 imports and snapshots remain supported. Snapshot quota failures block changes safely.

`src/application/` contains pure form commands, the testable workspace controller and React hooks. `src/persistence/` contains the repository contract, localStorage implementation and separate preferences. `src/domain/` defines identity, ownership/relationship and shared scheduling contracts. `src/platform/` registers the six long-term command centers and inactive AI scope/entitlement contracts. `src/safety.ts` retains portable validation, export, snapshots and Undo. UI components still compose the same domain selectors and charts.

Calendar dates remain device-local calendar dates, with DST-safe day arithmetic. Existing weekly commitments remain floating local wall times and derived occurrences; future zoned events have separate interval contracts. Owner and entitlement context never comes from an imported file. Local ownership is a browser namespace, not authentication. No external AI access, subscriptions or new feature pages are activated.

See [the revised cloud roadmap](docs/cloud-migration.md) and [proposed relational schema](docs/relational-schema.md). PostgreSQL/Supabase remains a future option; normalized private tables are proposed as primary storage, with JSONB for extensions/preferences/snapshots. These documents supersede the older single-workspace-JSON cloud proposal.

## Validation

Run `npm test` and `npm run build`. The 158 automated tests cover existing planner, fitness, personalization and recovery functionality plus schema 1–5 migration, stable identity/idempotence, unknown-field preservation, old-backup round trips, first-write migration snapshots, storage failures, repository conflicts, extracted commands, course-linked Undo, calendar/timezone boundaries, owner-scoped relationships and inactive AI/module contracts. Desktop/mobile regression checks exercise planner and Today connections, quick add, habits, fitness logs/goals, reflections, export/import/restore/clear, Undo and real simultaneous browser-tab writes.

An optional repeatable Chromium regression lives in `scripts/browser-smoke.cjs`. With Playwright and Chromium installed, start `npm run preview` after the build, then run `node scripts/browser-smoke.cjs`. Set `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE` or `DYLAN_PREVIEW_URL` when those differ from the defaults. The script uses only synthetic data in an isolated browser context and checks legacy migrations, exact pre-migration snapshots, old import, habit/date Undo and mobile navigation. Playwright is optional and is not an application dependency.

## Scope and next milestone

This remains a single-user local application. There is no authentication, cloud database, upload, external integration, billing or paid AI. Keep exported backup files outside browser storage; snapshots share the browser origin and do not protect against clearing all browser data.

Recommended **Version 1.5.2**, subject to separate approval: staging-only Supabase Auth/private relational tables for current domains, RLS, authenticated atomic commands/revisions/snapshots, synthetic two-user security tests and account/session lifecycle foundations. Preserve the local adapter and UI. Exclude real-data migration and production activation until 1.5.3; exclude AI, billing and integrations. Version 1.5.2 has not begun.
