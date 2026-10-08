export const COLLECTIONS = [
  "tasks",
  "courses",
  "assignments",
  "weights",
  "workouts",
  "nutrition",
  "habits",
  "dates",
  "commitments",
  "weeklyReflections",
] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const LEGACY_ID_COLLECTIONS = [
  "weights",
  "nutrition",
  "habits",
  "dates",
] as const;
