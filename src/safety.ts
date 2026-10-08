import {
  COLLECTIONS as collections,
  LEGACY_ID_COLLECTIONS,
} from "./domain/collections";
import { addLegacyIds } from "./domain/identity";
import { isCalendarDate } from "./dates";
import type { State } from "./data";
export const STORAGE_KEY = "dylan-os-v1";
export function emptyWorkspace(): State {
  return {
    commitments: [],
    weeklyReflections: [],
    tasks: [],
    courses: [],
    assignments: [],
    weights: [],
    workouts: [],
    nutrition: [],
    habits: [],
    dates: [],
    goalWeight: null,
  };
}
import { localDate } from "./dates";
export const SCHEMA_VERSION = 6;
export const BACKUP_KEY = "dylan-os-backups-v1";
export const EXPORT_KEY = "dylan-os-last-export";
export const MAX_BACKUPS = 5;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as RecordValue;
}
function text(v: unknown, label: string, nonempty = true) {
  if (typeof v !== "string" || (nonempty && !v.trim()))
    throw new Error(`${label} must be text.`);
}
function num(
  v: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error(
      `${label} must be a valid number between ${min} and ${max}.`,
    );
}
function date(v: unknown, label: string) {
  text(v, label);
  if (!isCalendarDate(v))
    throw new Error(`${label} must be a real YYYY-MM-DD date.`);
}
function bool(v: unknown, label: string) {
  if (typeof v !== "boolean")
    throw new Error(`${label} must be true or false.`);
}
function optionalDate(r: RecordValue, key: string) {
  if (r[key] !== undefined) date(r[key], key);
}
function grade(v: unknown) {
  if (v !== null && v !== undefined) num(v, "Grade", 0, 100);
}
export function validateWorkspace(value: unknown): State {
  const root = object(value);
  const schema = root.schemaVersion === undefined ? 1 : root.schemaVersion;
  if (
    !Number.isInteger(schema) ||
    ![1, 2, 3, 4, 5, 6].includes(schema as number)
  )
    throw new Error(
      "Unsupported workspace schema. Supported versions: 1, 2, 3, 4, 5, 6.",
    );
  for (const key of collections) {
    if (
      (key === "commitments" || key === "weeklyReflections") &&
      root[key] === undefined &&
      (schema as number) < 5
    )
      continue;
    if (!Array.isArray(root[key]))
      throw new Error(`Missing or invalid collection: ${key}.`);
    for (const value of root[key] as unknown[]) object(value);
  }
  if (root.goalWeight !== null) num(root.goalWeight, "Goal weight", 1, 1500);
  for (const key of ["tasks", "courses", "assignments", "workouts"] as const) {
    const ids = new Set();
    for (const value of root[key] as unknown[]) {
      const r = object(value);
      text(r.id, "Record ID");
      if (ids.has(r.id)) throw new Error(`Duplicate ID in ${key}.`);
      ids.add(r.id);
      text(r.name, "Name");
    }
  }
  for (const value of root.tasks as unknown[]) {
    const r = object(value);
    text(r.category, "Category");
    if (!["High", "Medium", "Low"].includes(r.priority as string))
      throw new Error("Invalid task priority.");
    date(r.due, "Task due date");
    bool(r.completed, "Task completion");
    bool(r.recurring, "Task recurrence");
    optionalDate(r, "completedOn");
  }
  const courseIds = new Set((root.courses as RecordValue[]).map((c) => c.id));
  for (const value of root.courses as unknown[]) {
    const r = object(value);
    text(r.code, "Course code");
    text(r.instructor, "Instructor", false);
    text(r.notes, "Course notes", false);
    if (!("grade" in r))
      throw new Error("Missing course grade (use null when unknown).");
    grade(r.grade);
  }
  for (const value of root.assignments as unknown[]) {
    const r = object(value);
    if (!courseIds.has(r.courseId))
      throw new Error("School work references a missing course.");
    date(r.due, "School due date");
    if (!["Assignment", "Exam"].includes(r.type as string))
      throw new Error("Invalid school work type.");
    bool(r.completed, "School completion");
    optionalDate(r, "completedOn");
    grade(r.grade);
    if (r.notes !== undefined) text(r.notes, "School notes", false);
  }
  for (const key of ["weights", "nutrition"] as const) {
    const dates = new Set();
    for (const value of root[key] as unknown[]) {
      const r = object(value);
      date(r.date, "Log date");
      if (dates.has(r.date)) throw new Error(`Duplicate day in ${key}.`);
      dates.add(r.date);
      if (key === "weights") num(r.value, "Body weight", 1, 1500);
      else {
        num(r.calories, "Calories");
        num(r.protein, "Protein");
        num(r.steps, "Steps");
        if (!Number.isInteger(r.steps))
          throw new Error("Steps must be a whole number.");
      }
    }
  }
  for (const value of root.workouts as unknown[]) {
    const r = object(value);
    date(r.date, "Workout date");
    text(r.exercise, "Exercise");
    num(r.weight, "Working weight");
    if (r.sets !== undefined) {
      num(r.sets, "Sets", 1, 100);
      if (!Number.isInteger(r.sets))
        throw new Error("Sets must be whole numbers.");
    }
    num(r.reps, "Reps", 1);
    if (!Number.isInteger(r.reps))
      throw new Error("Reps must be a whole number.");
    bool(r.completed, "Workout completion");
  }
  for (const value of root.habits as unknown[]) {
    const r = object(value);
    text(r.name, "Habit name");
    optionalDate(r, "createdOn");
    if (!Array.isArray(r.dates))
      throw new Error("Habit completion history must be an array.");
    for (const d of r.dates) date(d, "Habit completion date");
  }
  for (const value of root.dates as unknown[]) {
    const r = object(value);
    text(r.name, "Important date name");
    date(r.date, "Important date");
  }
  const validateDays = (days: unknown) => {
    if (
      !Array.isArray(days) ||
      !days.length ||
      days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    )
      throw new Error("Habit schedule must contain weekdays 0–6.");
  };
  for (const h of root.habits as RecordValue[]) {
    if (h.target !== undefined) {
      num(h.target, "Habit target", 1, 100);
      if (!Number.isInteger(h.target))
        throw new Error("Habit target must be a whole number.");
    }
    if (h.schedule !== undefined) validateDays(h.schedule);
    if (h.counts !== undefined) {
      for (const [d, count] of Object.entries(object(h.counts))) {
        date(d, "Habit history date");
        num(count, "Habit count", 0, 100);
        if (!Number.isInteger(count))
          throw new Error("Habit counts must be whole numbers.");
      }
    }
    if (h.scheduleHistory !== undefined) {
      if (!Array.isArray(h.scheduleHistory))
        throw new Error("Invalid habit schedule history.");
      for (const entry of h.scheduleHistory) {
        const p = object(entry);
        date(p.effectiveOn, "Schedule effective date");
        validateDays(p.days);
        num(p.target, "Historical target", 1, 100);
        if (!Number.isInteger(p.target))
          throw new Error("Historical targets must be whole numbers.");
      }
    }
  }
  if (root.preferences !== undefined) {
    const prefs = object(root.preferences);
    if (prefs.dashboard !== undefined) {
      const d = object(prefs.dashboard);
      for (const key of ["order", "hidden"])
        if (
          !Array.isArray(d[key]) ||
          (d[key] as unknown[]).some((x) => typeof x !== "string")
        )
          throw new Error("Invalid dashboard preferences.");
    }
    if (prefs.priorities !== undefined) {
      const p = object(prefs.priorities);
      date(p.date, "Priority date");
      if (
        !Array.isArray(p.ids) ||
        p.ids.length > 3 ||
        p.ids.some((x) => typeof x !== "string")
      )
        throw new Error("Choose up to three priorities.");
    }
  }
  const commitmentIds = new Set();
  const signatures = new Set();
  for (const value of (root.commitments ?? []) as unknown[]) {
    const r = object(value);
    text(r.id, "Commitment ID");
    if (commitmentIds.has(r.id)) throw new Error("Duplicate commitment ID.");
    commitmentIds.add(r.id);
    text(r.name, "Commitment name");
    if (!["Class", "Work", "Personal"].includes(r.kind as string))
      throw new Error("Invalid commitment type.");
    validateDays(r.days);
    if (new Set(r.days as number[]).size !== (r.days as number[]).length)
      throw new Error("Duplicate commitment weekdays.");
    for (const key of ["startTime", "endTime"])
      if (
        typeof r[key] !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(r[key] as string)
      )
        throw new Error("Commitment times must use HH:MM.");
    if ((r.endTime as string) <= (r.startTime as string))
      throw new Error(
        "End time must be after start time. Split overnight commitments into two entries.",
      );
    date(r.startsOn, "Commitment start date");
    if (r.endsOn !== null) {
      date(r.endsOn, "Commitment end date");
      if ((r.endsOn as string) < (r.startsOn as string))
        throw new Error("Commitment end date precedes start date.");
    }
    if (!Array.isArray(r.exceptions))
      throw new Error("Commitment exceptions must be an array.");
    r.exceptions.forEach((d) => date(d, "Exception date"));
    if (new Set(r.exceptions).size !== r.exceptions.length)
      throw new Error("Duplicate exception dates.");
    const signature = JSON.stringify([
      (r.name as string).trim().toLowerCase(),
      r.kind,
      [...(r.days as number[])].sort(),
      r.startTime,
      r.endTime,
      r.startsOn,
      r.endsOn,
    ]);
    if (signatures.has(signature))
      throw new Error("This weekly commitment already exists.");
    signatures.add(signature);
  }
  const reflectionIds = new Set(),
    weeks = new Set();
  for (const value of (root.weeklyReflections ?? []) as unknown[]) {
    const r = object(value);
    text(r.id, "Reflection ID");
    date(r.weekStart, "Reflection week");
    if (new Date(r.weekStart + "T12:00:00").getDay() !== 1)
      throw new Error("Reflection week must start on Monday.");
    if (reflectionIds.has(r.id) || weeks.has(r.weekStart))
      throw new Error("Duplicate weekly reflection.");
    reflectionIds.add(r.id);
    weeks.add(r.weekStart);
    text(r.reflection, "Weekly reflection", false);
    if (!Array.isArray(r.priorities) || r.priorities.length !== 3)
      throw new Error("Enter exactly three priorities for the following week.");
    r.priorities.forEach((p) => text(p, "Weekly priority"));
    if (
      new Set((r.priorities as string[]).map((p) => p.trim().toLowerCase()))
        .size !== 3
    )
      throw new Error("Choose three distinct weekly priorities.");
    if (
      typeof r.savedAt !== "string" ||
      !Number.isFinite(Date.parse(r.savedAt))
    )
      throw new Error("Invalid reflection save timestamp.");
  }
  if (root.fitnessGoals !== undefined) {
    const goals = object(root.fitnessGoals);
    for (const [key, max] of [
      ["calories", 20000],
      ["protein", 2000],
      ["steps", 100000],
      ["weeklyWorkouts", 21],
    ] as const) {
      if (goals[key] === null) continue;
      num(goals[key], "Fitness goal " + key, 1, max);
      if (key !== "protein" && !Number.isInteger(goals[key]))
        throw new Error("This fitness goal must be a whole number.");
    }
  }
  if (schema === SCHEMA_VERSION)
    for (const key of LEGACY_ID_COLLECTIONS)
      for (const value of root[key] as RecordValue[])
        text(value.id, "Record ID");
  const identified = addLegacyIds(root);
  for (const key of LEGACY_ID_COLLECTIONS) {
    const ids = new Set();
    for (const value of identified[key] as RecordValue[]) {
      text(value.id, "Record ID");
      if (ids.has(value.id)) throw new Error(`Duplicate ID in ${key}.`);
      ids.add(value.id);
    }
  }
  // Keep every unknown field, at every nesting level. No reconstruction from a field allowlist.
  return {
    ...identified,
    commitments: root.commitments ?? [],
    weeklyReflections: root.weeklyReflections ?? [],
    schemaVersion: SCHEMA_VERSION,
  } as State;
}
export function exportWorkspace(state: State, now = new Date()) {
  return { ...validateWorkspace(state), exportedAt: now.toISOString() };
}
export function backupFilename(now = new Date()) {
  return `dylan-os-backup-${localDate(now)}.json`;
}
export function parseImport(raw: string): State {
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES)
    throw new Error("Backup exceeds the 5 MB import limit.");
  const parsed = object(JSON.parse(raw));
  if (
    parsed.exportedAt !== undefined &&
    (typeof parsed.exportedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.exportedAt)))
  )
    throw new Error("Invalid export timestamp.");
  return validateWorkspace(parsed); // Accept legacy raw workspace JSON too.
}
export function summary(state: State) {
  return Object.fromEntries(collections.map((k) => [k, state[k].length]));
}
export type Snapshot = {
  id: string;
  createdAt: string;
  reason: string;
  raw: string;
};
export type Store = Pick<Storage, "getItem" | "setItem">;
export function snapshots(store: Store): Snapshot[] {
  const raw = store.getItem(BACKUP_KEY);
  if (!raw) return [];
  const list = JSON.parse(raw);
  if (
    !Array.isArray(list) ||
    list.some(
      (s) =>
        !s ||
        typeof s.id !== "string" ||
        typeof s.reason !== "string" ||
        typeof s.raw !== "string" ||
        typeof s.createdAt !== "string",
    )
  )
    throw new Error(
      "Local backup history could not be read. Export your current workspace before repairing storage.",
    );
  return list;
}
export function persist(
  store: Store,
  current: State,
  next: State,
  reason?: string,
) {
  const validated = validateWorkspace(next);
  const json = JSON.stringify(validated);
  const originalRaw = store.getItem(STORAGE_KEY);
  let originalSchema: unknown = SCHEMA_VERSION;
  try {
    originalSchema = originalRaw
      ? JSON.parse(originalRaw).schemaVersion
      : SCHEMA_VERSION;
  } catch {
    originalSchema = null;
  }
  const backupReason =
    reason ||
    (originalRaw && originalSchema !== SCHEMA_VERSION
      ? "Before migrating workspace to schema 6"
      : undefined);
  if (backupReason) {
    const before = store.getItem(STORAGE_KEY) ?? JSON.stringify(current);
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      reason: backupReason,
      raw: before,
    };
    store.setItem(
      BACKUP_KEY,
      JSON.stringify([snapshot, ...snapshots(store)].slice(0, MAX_BACKUPS)),
    );
  }
  store.setItem(STORAGE_KEY, json);
  return validated;
}
export function restoreSnapshot(
  store: Store,
  current: State,
  snapshot: Snapshot,
) {
  return persist(
    store,
    current,
    parseImport(snapshot.raw),
    "Before restoring backup",
  );
}
export function clearWorkspace(
  store: Store,
  current: State,
  confirmation: string,
) {
  if (confirmation !== "CLEAR MY WORKSPACE")
    throw new Error("Type CLEAR MY WORKSPACE to confirm.");
  return persist(store, current, emptyWorkspace(), "Before clearing workspace");
}
export type Deletion = {
  removed: Partial<Record<(typeof collections)[number], unknown[]>>;
  label: string;
  expiresAt: number;
};
export function deletion(
  before: State,
  after: State,
  label: string,
  now = Date.now(),
): Deletion {
  const removed: Deletion["removed"] = {};
  for (const k of collections) {
    const items = (before[k] as unknown[]).filter(
      (item) => !(after[k] as unknown[]).includes(item),
    );
    if (items.length) removed[k] = items;
  }
  return { removed, label, expiresAt: now + 30000 };
}
export function undoDeletion(
  current: State,
  entry: Deletion,
  now = Date.now(),
): State {
  if (now >= entry.expiresAt)
    throw new Error("Undo expired. Restore the local snapshot instead.");
  const next = { ...current };
  for (const [key, removed] of Object.entries(entry.removed)) {
    const k = key as (typeof collections)[number];
    const items = [...current[k]] as RecordValue[];
    for (const value of removed!) {
      const item = value as RecordValue;
      const match = items.some((r) =>
        item.id !== undefined
          ? r.id === item.id
          : k === "habits"
            ? r.name === item.name
            : k === "dates"
              ? r.name === item.name && r.date === item.date
              : r.date === item.date,
      );
      if (match)
        throw new Error(
          "A restored record would conflict with a newer record. Use the backup preview instead.",
        );
      items.push(item);
    }
    Object.assign(next, { [k]: items });
  }
  return validateWorkspace(next);
}
