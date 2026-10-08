export const MODULES = [
  { id: "home", name: "Home", status: "available", collections: [] },
  {
    id: "health",
    name: "Health",
    status: "partial",
    collections: ["weights", "nutrition", "workouts"],
  },
  { id: "finances", name: "Finances", status: "planned", collections: [] },
  {
    id: "college",
    name: "College",
    status: "partial",
    collections: ["courses", "assignments"],
  },
  {
    id: "life",
    name: "Life & Goals",
    status: "partial",
    collections: [
      "tasks",
      "habits",
      "dates",
      "commitments",
      "weeklyReflections",
    ],
  },
  {
    id: "library",
    name: "Personal Library",
    status: "planned",
    collections: [],
  },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];
/** Existing labels/routes stay unchanged. Planned centers never create empty pages. */
export const CURRENT_ROUTES = [
  { name: "Today", module: "home" },
  { name: "Weekly Planner", module: "home" },
  { name: "College", module: "college" },
  { name: "Fitness", module: "health" },
  { name: "Tasks", module: "life" },
  { name: "AI Assistant", module: "home" },
  { name: "Data & Backup", module: "home" },
] as const;
export const COMMERCIAL_POLICY = {
  minimumAge: 18,
  commercialLaunchEnabled: false,
} as const;
