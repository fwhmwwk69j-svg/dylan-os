# Dylan OS

A personal operating system for a more intentional day. Version 1 is a working, responsive React + TypeScript application with a calm green design, light and dark modes, and realistic sample data.

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

## Version 1

- **Today:** local date, high-priority focus, due-today tasks, pending assignments, workout, habit checklist, weight trend, upcoming dates, and quick add.
- **College:** course pages, editable course details and notes, recorded grades, assignments/exams, deadlines, and completion. Add assignments from the dashboard or a course page. Click an assignment to edit it.
- **Fitness:** weight logging and goal, 7-calendar-day average, weight chart, calories/protein/steps logging, workout logging, exercise history, bench press working-weight progression, records, and workout consistency. Each workout entry represents one working set; this is not a comprehensive training program or a one-rep-max calculator.
- **Tasks:** add/edit/delete, categories, priorities, due dates, completion, daily recurrence, and filtered views. Completing a recurring task creates its next day's occurrence without duplicates.
- **AI Assistant:** a clearly labeled local preview with six useful prompts. A deterministic adapter reads current workspace data; no AI model, external API, billing, or data transmission is implemented.

All edits persist in the browser's `localStorage` on the current origin (`dylan-os-v1`), with theme under `dylan-theme`. Sample dates are relative to the first launch. Clearing site data resets the sample workspace. Data is specific to that browser/device and is not backed up or synchronized. No authentication or database is connected in V1. Do not rely on this version as the sole record of important data.

## Architecture and future integrations

`src/data.ts` defines the typed domain entities, sample data, recurrence/average calculations, and the `AssistantProvider` contract. Tasks, courses, assignments, workouts, and dated logs use stable IDs and explicit relationships. `src/App.tsx` owns the shared state and renders the five areas; `src/Charts.tsx` loads charts on demand, and `src/styles.css` contains responsive layouts and theme variables. Fonts are bundled locally, so the application makes no external font requests. Existing data tests exercise cross-area behavior.

Future database work should replace local persistence with a repository/service layer and user-scoped entities while preserving these domain contracts. Add authentication and server authorization before sharing or syncing private records. Calendar, task-manager, and fitness integrations can normalize their data into the same entities with external source IDs and explicit timezone handling.

The future AI provider should call an authenticated server endpoint, load only the signed-in user's permitted data, and keep API keys server-side. The assistant interface depends on `AssistantProvider.reply(question, state)`, allowing the local adapter to be replaced. Keep read operations separate from any future action tools; require confirmation before writing records or calendars. Conversation state is currently session-only.

## Validation

The foundation includes automated tests for recurrence, calendar-window averaging, assignment context, and completed-priority exclusion. Desktop/mobile browser smoke checks cover navigation, task creation/editing/completion, reload persistence, course creation and notes, assignment creation, weight/workout logging, assistant responses using edited data, and theme persistence.

## Scope

This is a single-user local foundation. Authentication, database persistence, cloud sync, integrations, paid AI, assignment-level grade calculations, advanced workout programming, and editing important dates/habit definitions are follow-on work. There is no deployment configuration or backend service to operate yet.
