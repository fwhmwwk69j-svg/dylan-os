import type { State } from "./data";
export const STORAGE_KEY = "dylan-os-v1";
export function emptyWorkspace(): State {
  return {
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
export const SCHEMA_VERSION = 3;
export const BACKUP_KEY = "dylan-os-backups-v1";
export const EXPORT_KEY = "dylan-os-last-export";
export const MAX_BACKUPS = 5;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const collections = [
  "tasks",
  "courses",
  "assignments",
  "weights",
  "workouts",
  "nutrition",
  "habits",
  "dates",
] as const;
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
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v as string) ||
    localDate(new Date(`${v}T12:00:00`)) !== v
  )
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
  if (!Number.isInteger(schema) || ![1, 2, 3].includes(schema as number))
    throw new Error(
      "Unsupported workspace schema. Supported versions: 1, 2, 3.",
    );
  for (const key of collections) {
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
  // Keep every unknown field, at every nesting level. No reconstruction from a field allowlist.
  return { ...root, schemaVersion: SCHEMA_VERSION } as State;
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
  if (reason) {
    const before = store.getItem(STORAGE_KEY) ?? JSON.stringify(current);
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      reason,
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
