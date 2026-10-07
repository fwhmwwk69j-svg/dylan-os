# Dylan OS

A personal operating system for a more intentional day. Version 1.1 is a responsive React + TypeScript application with a calm green design, light and dark modes, and a personal workspace that starts empty. Existing Version 1 records are preserved.

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

## Version 1.1

- **Today:** overdue tasks first, due-today tasks, separate upcoming assignments and exams (next 14 days plus all overdue work), today's workout, editable daily habits, weight progress, editable important dates, and quick add. Urgency labels distinguish overdue, today, tomorrow, and the next three days. The dashboard refreshes its date when left open overnight.
- **College:** add your real courses, edit their details, leave grades blank until known, and maintain course notes. Add/edit/delete assignments and exams with optional recorded grades and notes. Open a course and choose **Edit course** to replace old demo details; **Delete course** confirms removal of the course and its linked school work. Existing courses are never silently deleted.
- **Fitness:** log weights, an optional goal, calories/protein/steps by date, and planned or completed workouts. Existing charts, exercise history, and personal records remain. Each workout entry is one working set; multiple completed sets with the same workout name/date count as one session.
- **Tasks:** add/edit/delete, categories, priorities, due dates, completion, daily recurrence, and overdue filtering. Completing an overdue recurring task schedules its next occurrence for tomorrow rather than creating more overdue copies.
- **Quick add:** the plus button is available on every page; Today also has a labeled Quick add button. Add a task, assignment, exam, weight entry, workout, or habit check-in. If no courses exist, adding school work first opens a course form and then returns to the assignment/exam form. Add/edit habits from Today; habit check-ins can be backdated to days when the habit existed.
- **Weekly review:** open **Weekly review** from Today. The last seven calendar days summarize tasks and school work by actual completion date, pending school workload including overdue work, first-to-last weight change, workout sessions, average steps across logged days, and habit consistency. Missing weights/steps show an empty state. New habits count only from creation; older habits have no known creation date and count across the full seven-day window.
- **AI Assistant:** a labeled, deterministic local preview that reads workspace data. No AI model, external API, billing, or data transmission is implemented; the weekly-review prompt shares the new review calculations.

All edits use the same browser `localStorage` key (`dylan-os-v1`), with theme under `dylan-theme`. Migration is additive and preserves Version 1 records. Existing completed tasks/assignments without a completion date remain completed, but are excluded from weekly counts and called out as undated. Completing or reopening records updates their completion date going forward. Course/assignment edits preserve these dates. A malformed saved workspace is retained and protected from accidental replacement.

New browsers start with no fabricated courses, deadlines, workouts, weight, nutrition, or habits. The sample fixture remains only for automated tests. Clearing site data deletes the workspace; data is specific to the browser/origin and is not backed up or synchronized. No authentication or database is connected.

## Architecture and future integrations

`src/data.ts` defines typed domain entities, the test sample fixture, recurrence/average calculations, and the `AssistantProvider` contract. `src/dates.ts` handles local calendar dates. `src/personal.ts` owns additive restoration, urgency, completion tracking, and review calculations; `src/WeeklyReview.tsx` renders the review. Tasks, courses, assignments, workouts, and dated logs use stable IDs and explicit relationships. `src/App.tsx` owns the shared state and renders the five areas; `src/Charts.tsx` loads charts on demand, and `src/styles.css` contains responsive layouts and theme variables. Fonts are bundled locally, so the application makes no external font requests. Existing data tests exercise cross-area behavior.

Future database work should replace local persistence with a repository/service layer and user-scoped entities while preserving these domain contracts. Add authentication and server authorization before sharing or syncing private records. Calendar, task-manager, and fitness integrations can normalize their data into the same entities with external source IDs and explicit timezone handling.

The future AI provider should call an authenticated server endpoint, load only the signed-in user's permitted data, and keep API keys server-side. The assistant interface depends on `AssistantProvider.reply(question, state)`, allowing the local adapter to be replaced. Keep read operations separate from any future action tools; require confirmation before writing records or calendars. Conversation state is currently session-only.

## Validation

The automated suites cover V1 compatibility, blank workspaces, malformed storage rejection, completion timestamps, recurrence, urgency boundaries, overdue ordering, calendar boundaries, course cleanup, workout counting, logged-day step averages, weight trends, habit opportunities, and assistant context. Production browser smoke checks additionally cover fresh and legacy workspaces, quick-entry flows, grade/notes editing, persistence, weekly-review calculations, and desktop/mobile layouts.

## Scope

This is a single-user local system. Authentication, database persistence, cloud sync, integrations, paid AI, calculated course grades, and advanced workout programming remain follow-on work. There is no backend service to operate. Recorded course grades are manual; assignment grades do not automatically recalculate a course grade.

The logical Version 1.2 is data portability and recovery: validated JSON export/import, a backup reminder, and reversible deletion. That protects real personal records without adding a database or account system.
