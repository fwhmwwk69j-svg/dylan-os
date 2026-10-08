import { SCHEMA_VERSION } from "./safety";
import type { State, Habit } from "./data";
import { day, localDate } from "./dates";
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const DASHBOARD_CARDS = [
  "priorities",
  "overdue",
  "tasks",
  "assignments",
  "exams",
  "workout",
  "habits",
  "fitness",
  "dates",
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];
export function habitPlan(h: Habit, date: string) {
  const history = h.scheduleHistory
    ?.filter((p) => p.effectiveOn <= date)
    .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn));
  return (
    history?.at(-1) ?? { days: h.schedule ?? EVERY_DAY, target: h.target ?? 1 }
  );
}
export function scheduled(h: Habit, date = day()) {
  return (
    (!h.createdOn || date >= h.createdOn) &&
    habitPlan(h, date).days.includes(new Date(date + "T12:00:00").getDay())
  );
}
export function habitCount(h: Habit, date = day()) {
  return h.counts?.[date] ?? (h.dates.includes(date) ? 1 : 0);
}
export function habitComplete(h: Habit, date = day()) {
  return habitCount(h, date) >= habitPlan(h, date).target;
}
export function setHabitCount(
  state: State,
  index: number,
  count: number,
  date = day(),
): State {
  if (!Number.isInteger(count) || count < 0 || count > 100)
    throw new Error("Habit count must be between 0 and 100.");
  return {
    ...state,
    habits: state.habits.map((h, i) =>
      i !== index
        ? h
        : {
            ...h,
            counts: { ...h.counts, [date]: count },
            dates:
              count >= habitPlan(h, date).target
                ? [...new Set([...h.dates, date])]
                : h.dates.filter((d) => d !== date),
          },
    ),
  };
}
export function editHabitPlan(
  h: Habit,
  name: string,
  target: number,
  days: number[],
  date = day(),
): Habit {
  if (!days.length) throw new Error("Choose at least one scheduled day.");
  const original = {
    effectiveOn: h.createdOn ?? "1900-01-01",
    days: h.schedule ?? EVERY_DAY,
    target: h.target ?? 1,
  };
  return {
    ...h,
    name,
    target,
    schedule: days,
    scheduleHistory: [
      ...(h.scheduleHistory ?? [original]).filter(
        (p) => p.effectiveOn !== date,
      ),
      {
        ...h.scheduleHistory?.find((p) => p.effectiveOn === date),
        effectiveOn: date,
        days,
        target,
      },
    ],
  };
}
export function habitWeek(h: Habit, end = day()) {
  let possible = 0,
    complete = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(end + "T12:00:00");
    d.setDate(d.getDate() - i);
    const date = localDate(d);
    if (scheduled(h, date)) {
      possible++;
      if (habitComplete(h, date)) complete++;
    }
  }
  return {
    possible,
    complete,
    percent: possible ? Math.round((complete / possible) * 100) : null,
  };
}
export function habitStreak(h: Habit, today = day()) {
  let streak = 0;
  const start =
    h.createdOn ??
    [...h.dates, ...Object.keys(h.counts ?? {})].sort()[0] ??
    today;
  const d = new Date(today + "T12:00:00");
  if (scheduled(h, today) && !habitComplete(h, today))
    d.setDate(d.getDate() - 1);
  while (localDate(d) >= start) {
    const date = localDate(d);
    if (scheduled(h, date)) {
      if (!habitComplete(h, date)) break;
      streak++;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
export function dashboardPreferences(state: State) {
  const saved = state.preferences?.dashboard;
  const order = [
    ...new Set([...(saved?.order ?? []), ...DASHBOARD_CARDS]),
  ].filter((id) =>
    DASHBOARD_CARDS.includes(id as DashboardCard),
  ) as DashboardCard[];
  return {
    order,
    hidden: saved?.hidden ?? [],
    priorities:
      state.preferences?.priorities?.date === day()
        ? [...new Set(state.preferences.priorities.ids)].filter((id) =>
            state.tasks.some((t) => t.id === id && !t.completed),
          )
        : [],
  };
}
export const EXPORT_STATUS_KEY = "dylan-os-export-status-v1";
export const REMINDER_KEY = "dylan-os-backup-reminder-v1";
export function workspaceContent(state: State) {
  const { exportedAt: ignored, ...rest } = state as State & {
    exportedAt?: string;
  };
  void ignored;
  return JSON.stringify({ ...rest, schemaVersion: SCHEMA_VERSION });
}
export type ExportStatus = {
  requestedAt: string;
  confirmedAt?: string;
  content: string;
};
export function backupReminder(
  status: ExportStatus | null,
  dismissedUntil: number,
  now = Date.now(),
) {
  return (
    now >= dismissedUntil &&
    (!status?.confirmedAt ||
      now - Date.parse(status.confirmedAt) >= 7 * 86400000)
  );
}

export function parseExportStatus(raw: string | null): ExportStatus | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value.content !== "string" ||
      typeof value.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(value.requestedAt))
    )
      return null;
    if (
      value.confirmedAt !== undefined &&
      (typeof value.confirmedAt !== "string" ||
        !Number.isFinite(Date.parse(value.confirmedAt)))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
