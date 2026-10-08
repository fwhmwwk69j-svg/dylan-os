# Dylan OS

A personal operating system for a more intentional day. Version 1.2 is a responsive React + TypeScript application with a calm green design, light and dark modes, and a personal workspace that starts empty. Existing Version 1 and 1.1 records are preserved.

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
- **Fitness:** log weights, an optional goal, calories/protein/steps by date, and planned or completed workouts. Existing charts, exercise history, and personal records remain. Each workout entry is one working set; multiple completed sets with the same workout name/date count as one session.
- **Tasks:** add/edit/delete, categories, priorities, due dates, completion, daily recurrence, and overdue filtering. Completing an overdue recurring task schedules its next occurrence for tomorrow rather than creating more overdue copies.
- **Quick add:** the plus button is available on every page; Today also has a labeled Quick add button. Add a task, assignment, exam, weight entry, workout, or habit check-in. If no courses exist, adding school work first opens a course form and then returns to the assignment/exam form. Add/edit habits from Today; habit check-ins can be backdated to days when the habit existed.
- **Weekly review:** open **Weekly review** from Today. The last seven calendar days summarize tasks and school work by actual completion date, pending school workload including overdue work, first-to-last weight change, workout sessions, average steps across logged days, and habit consistency. Missing weights/steps show an empty state. New habits count only from creation; older habits have no known creation date and count across the full seven-day window.
- **AI Assistant:** a labeled, deterministic local preview that reads workspace data. No AI model, external API, billing, or data transmission is implemented; the weekly-review prompt shares the new review calculations.

All edits use the same browser `localStorage` key (`dylan-os-v1`), with theme under `dylan-theme`. Migration is additive and preserves Version 1 records. Existing completed tasks/assignments without a completion date remain completed, but are excluded from weekly counts and called out as undated. Completing or reopening records updates their completion date going forward. Course/assignment edits preserve these dates. A malformed saved workspace is retained and protected from accidental replacement.

New browsers start with no fabricated courses, deadlines, workouts, weight, nutrition, or habits. The sample fixture remains only for automated tests. Clearing site data deletes the workspace; data is specific to the browser/origin and is not backed up or synchronized. No authentication or database is connected.

## Data safety and recovery (Version 1.2)

Open **Data & Backup** in the sidebar or mobile navigation.

1. **Export workspace** downloads `dylan-os-backup-YYYY-MM-DD.json`. It contains the full workspace, schema version 3, and an ISO export timestamp, including unknown fields. Store this file outside the browser. The page tracks when a download was requested; browsers cannot confirm that the file was saved.
2. **Import workspace** accepts JSON exports and legacy raw workspace JSON (schemas 1, 2, and 3, including unversioned V1 data). Files are limited to 5 MB. The validator checks every collection and record, field types, real calendar dates, numeric ranges, IDs, duplicate dated logs, course links, and supported schema versions. Invalid files do not write anything. Valid files show a count preview; checking the replacement acknowledgment and pressing **Confirm replacement** are both required.
3. **Local snapshots** preserve the exact previous stored JSON before imports, restores, clearing, deletions, and saved record edits. Course notes take a snapshot at the start of an editing session. Only the five newest snapshots are kept. **Restore backup** goes through validation, preview, and confirmation, then snapshots the workspace it replaces. Original snapshot JSON can also be downloaded.
4. **Undo deletion** is available for 30 seconds after the latest task, course, assignment/exam, workout, habit, or important-date deletion. Course Undo restores linked school work too. Undo merges deleted records into current data instead of rolling back edits made afterward; it refuses conflicting IDs/records. Older deletions can be recovered through retained snapshots, which replace the whole workspace after confirmation.
5. **Clear workspace** requires opening the clear controls, typing `CLEAR MY WORKSPACE` exactly, and pressing the final confirmation. A snapshot must be saved immediately beforehand. Theme, export status, and existing snapshots remain.

Workspace writes are committed to the UI only after storage succeeds. If snapshot creation fails (for example, storage is full), the destructive operation is blocked. If the final workspace write fails, the old workspace and the newly created recovery snapshot remain. Corrupt or unsupported saved workspace data is not silently reset: ordinary edits are blocked, original data can be downloaded, and a validated replacement can be confirmed explicitly. Unknown workspace and nested record fields survive loading, export/import, edits, and Undo; known schema versions migrate additively to 3.

Storage keys: `dylan-os-v1` (workspace, unchanged), `dylan-os-backups-v1` (snapshots), `dylan-os-last-export` (last export request), and `dylan-theme` (theme). Local snapshots are not off-device backups. Clearing browser site data or losing the device also loses those snapshots.

## Architecture and future integrations

`src/data.ts` defines typed domain entities, the test sample fixture, recurrence/average calculations, and the `AssistantProvider` contract. `src/dates.ts` handles local calendar dates. `src/safety.ts` owns shared validation, exports, snapshot rotation, safe writes, restoration, and deletion Undo. `src/DataBackup.tsx` renders the data controls. `src/personal.ts` owns workspace initialization, urgency, completion tracking, and review calculations; `src/WeeklyReview.tsx` renders the review. Tasks, courses, assignments, workouts, and dated logs use stable IDs and explicit relationships. `src/App.tsx` owns the shared state and renders the five core areas and Data & Backup; `src/Charts.tsx` loads charts on demand, and `src/styles.css` contains responsive layouts and theme variables. Fonts are bundled locally, so the application makes no external font requests. Existing data tests exercise cross-area behavior.

Future database work should replace local persistence with a repository/service layer and user-scoped entities while preserving these domain contracts. Add authentication and server authorization before sharing or syncing private records. Calendar, task-manager, and fitness integrations can normalize their data into the same entities with external source IDs and explicit timezone handling.

The future AI provider should call an authenticated server endpoint, load only the signed-in user's permitted data, and keep API keys server-side. The assistant interface depends on `AssistantProvider.reply(question, state)`, allowing the local adapter to be replaced. Keep read operations separate from any future action tools; require confirmation before writing records or calendars. Conversation state is currently session-only.

## Validation

The 68 automated tests cover export structure, full import validation, unsupported schemas, restore, backup rotation, storage-failure safety, clear confirmation, deletion Undo, course-linked restoration, V1 compatibility, blank workspaces, malformed storage rejection, completion timestamps, recurrence, urgency boundaries, overdue ordering, calendar boundaries, course cleanup, workout counting, logged-day step averages, weight trends, habit opportunities, and assistant context. Production desktop/mobile browser smoke checks cover real file downloads, import rejection/cancellation/confirmation, every deletion Undo, snapshots, clearing and restoring, storage quota failure, and preserved unknown fields. V1.1 smoke checks also cover fresh and legacy workspaces, quick-entry flows, grade/notes editing, persistence, weekly-review calculations, and desktop/mobile layouts.

## Scope

This is a single-user local system. Authentication, database persistence, cloud sync, integrations, paid AI, calculated course grades, and advanced workout programming remain follow-on work. There is no backend service to operate. Recorded course grades are manual; assignment grades do not automatically recalculate a course grade.

Recommended Version 1.3 scope: prevent stale writes across browser tabs; add a configurable weekly export reminder that shows whether data changed since the last export request; add correction/editing of historical weight and nutrition logs using existing snapshot and Undo protections. Keep authentication, cloud storage, integrations, and paid AI out of that release.
