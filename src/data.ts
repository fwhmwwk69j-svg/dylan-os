import { day, localDate } from "./dates";
export { day, localDate } from "./dates";
import { weeklyReview, dueTasks } from "./personal";
export type Task = {
  id: string;
  name: string;
  category: string;
  priority: "High" | "Medium" | "Low";
  due: string;
  completed: boolean;
  recurring: boolean;
  completedOn?: string;
};
export type Course = {
  id: string;
  name: string;
  code: string;
  instructor: string;
  grade: number | null;
  notes: string;
};
export type Assignment = {
  id: string;
  courseId: string;
  name: string;
  due: string;
  type: "Assignment" | "Exam";
  completed: boolean;
  completedOn?: string;
  grade?: number | null;
  notes?: string;
};
export type Weight = { id?: string; date: string; value: number };
export type Workout = {
  id: string;
  date: string;
  name: string;
  exercise: string;
  weight: number;
  reps: number;
  sets?: number;
  completed: boolean;
};
export type Habit = {
  id?: string;
  name: string;
  dates: string[];
  createdOn?: string;
  target?: number;
  schedule?: number[];
  counts?: Record<string, number>;
  scheduleHistory?: { effectiveOn: string; days: number[]; target: number }[];
};
export type Commitment = {
  id: string;
  name: string;
  kind: "Class" | "Work" | "Personal";
  days: number[];
  startTime: string;
  endTime: string;
  startsOn: string;
  endsOn: string | null;
  exceptions: string[];
};
export type FitnessGoals = {
  calories: number | null;
  protein: number | null;
  steps: number | null;
  weeklyWorkouts: number | null;
};
export type WeeklyReflection = {
  id: string;
  weekStart: string;
  reflection: string;
  priorities: string[];
  savedAt: string;
};
export type State = {
  tasks: Task[];
  courses: Course[];
  assignments: Assignment[];
  weights: Weight[];
  workouts: Workout[];
  schemaVersion?: number;
  goalWeight: number | null;
  commitments: Commitment[];
  weeklyReflections: WeeklyReflection[];
  fitnessGoals?: FitnessGoals;
  habits: Habit[];
  preferences?: {
    dashboard?: { order: string[]; hidden: string[] };
    priorities?: { date: string; ids: string[] };
  };
  nutrition: {
    id?: string;
    date: string;
    calories: number;
    protein: number;
    steps: number;
  }[];
  dates: { id?: string; name: string; date: string }[];
};
export const uid = () => crypto.randomUUID();
export function sampleData(): State {
  return {
    commitments: [],
    weeklyReflections: [],
    tasks: [
      {
        id: "t1",
        name: "Finish the research outline",
        category: "College",
        priority: "High",
        due: day(),
        completed: false,
        recurring: false,
      },
      {
        id: "t2",
        name: "Get a solid training session in",
        category: "Fitness",
        priority: "High",
        due: day(),
        completed: false,
        recurring: false,
      },
      {
        id: "t3",
        name: "Read 20 pages",
        category: "Personal",
        priority: "Medium",
        due: day(),
        completed: false,
        recurring: true,
      },
      {
        id: "t4",
        name: "Plan next week’s meals",
        category: "Personal",
        priority: "Low",
        due: day(2),
        completed: false,
        recurring: false,
      },
    ],
    courses: [
      {
        id: "c1",
        name: "Introduction to Psychology",
        code: "PSY 101",
        instructor: "Dr. Morgan",
        grade: 94,
        notes:
          "Review memory models before the midterm. Office hours: Tuesday, 2–4 PM.",
      },
      {
        id: "c2",
        name: "Calculus II",
        code: "MAT 202",
        instructor: "Prof. Chen",
        grade: 88,
        notes: "Practice integration by parts and series convergence.",
      },
      {
        id: "c3",
        name: "English Composition",
        code: "ENG 102",
        instructor: "Dr. Rivera",
        grade: 96,
        notes: "Research paper: focus on a clear thesis and credible sources.",
      },
    ],
    assignments: [
      {
        id: "a1",
        courseId: "c3",
        name: "Research paper outline",
        due: day(1),
        type: "Assignment",
        completed: false,
      },
      {
        id: "a2",
        courseId: "c2",
        name: "Problem set 04",
        due: day(3),
        type: "Assignment",
        completed: false,
      },
      {
        id: "a3",
        courseId: "c1",
        name: "Memory & cognition midterm",
        due: day(6),
        type: "Exam",
        completed: false,
      },
    ],
    weights: Array.from({ length: 28 }, (_, i) => ({
      date: day(i - 27),
      value: Math.round((183.4 - i * 0.13 + Math.sin(i) * 0.6) * 10) / 10,
    })),
    goalWeight: 175,
    workouts: [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `w${i}`,
        date: day(-27 + i * 3),
        name: "Upper body strength",
        exercise: "Bench press",
        weight: 135 + i * 5,
        reps: 5,
        completed: true,
      })),
      {
        id: "today",
        date: day(),
        name: "Upper body · push",
        exercise: "Bench press",
        weight: 175,
        reps: 5,
        completed: false,
      },
    ],
    habits: [
      { name: "Drink 2L of water", dates: [] },
      { name: "Read for 20 minutes", dates: [] },
      { name: "Get outside", dates: [] },
      { name: "Sleep 8 hours", dates: [] },
    ],
    nutrition: [{ date: day(), calories: 2150, protein: 148, steps: 6840 }],
    dates: [
      { name: "Fall break", date: day(12) },
      { name: "Mom’s birthday", date: day(18) },
    ],
  };
}
export function toggleTask(state: State, id: string, today = day()): State {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return state;
  const tasks = state.tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          completed: !t.completed,
          completedOn: t.completed ? undefined : today,
        }
      : t,
  );
  if (!task.completed && task.recurring) {
    const next = new Date((task.due > today ? task.due : today) + "T12:00:00");
    next.setDate(next.getDate() + 1);
    const due = localDate(next);
    if (!tasks.some((t) => t.name === task.name && t.due === due))
      tasks.push({
        ...task,
        id: uid(),
        due,
        completed: false,
        completedOn: undefined,
      });
  }
  return { ...state, tasks };
}
export function averageWeight(weights: Weight[], end = day()) {
  const start = new Date(end + "T12:00:00");
  start.setDate(start.getDate() - 6);
  const entries = weights.filter(
    (w) => w.date >= localDate(start) && w.date <= end,
  );
  return entries.length
    ? entries.reduce((s, w) => s + w.value, 0) / entries.length
    : 0;
}
export function sessionCount(workouts: Workout[]) {
  return new Set(
    workouts.filter((w) => w.completed).map((w) => `${w.date}:${w.name}`),
  ).size;
}
export interface AssistantProvider {
  reply(question: string, state: State): Promise<string>;
}
// Replace this adapter with an authenticated server provider when AI is enabled.
// Keep API keys on the server and require explicit approval for mutations.
export const localAssistant: AssistantProvider = {
  async reply(question, state) {
    const q = question.toLowerCase();
    const tasks = dueTasks(state);
    const assignments = state.assignments
      .filter((a) => !a.completed)
      .sort((a, b) => a.due.localeCompare(b.due));
    if (q.includes("bench")) {
      const entries = state.workouts
        .filter(
          (w) => w.completed && w.exercise.toLowerCase().includes("bench"),
        )
        .sort((a, b) => a.date.localeCompare(b.date));
      return entries.length
        ? `Your recorded bench press went from ${entries[0].weight} lb to ${entries.at(-1)!.weight} lb. Your best recorded set is ${Math.max(...entries.map((w) => w.weight))} lb. These are logged sets, not estimated one-rep maxes.`
        : "Log a completed bench press workout to see your progression.";
    }
    if (q.includes("weight")) {
      const entries = state.weights
        .filter((w) => w.date.startsWith(day().slice(0, 7)))
        .sort((a, b) => a.date.localeCompare(b.date));
      return entries.length
        ? `This month, your logged weight moved from ${entries[0].value} to ${entries.at(-1)!.value} lb (${(entries.at(-1)!.value - entries[0].value).toFixed(1)} lb). Your current 7-day average is ${averageWeight(state.weights).toFixed(1)} lb.`
        : "There are no weight entries for this month yet.";
    }
    if (q.includes("assignment"))
      return assignments.length
        ? assignments
            .slice(0, 5)
            .map(
              (a) =>
                `${a.name} — ${a.due < day() ? "overdue since" : "due"} ${a.due}`,
            )
            .join("\n")
        : "No upcoming assignments. You’re caught up!";
    if (q.includes("tomorrow") || q.includes("schedule"))
      return `Suggested plan for tomorrow (${day(1)}):\n• Start with a focused study block.\n${
        state.tasks
          .filter((t) => !t.completed && t.due === day(1))
          .map((t) => "• " + t.name)
          .join("\n") || "• No tasks scheduled yet."
      }\n${assignments
        .filter((a) => a.due === day(1))
        .map((a) => "• Submit " + a.name)
        .join(
          "\n",
        )}\n• Leave time for movement and a short evening review. This is a suggestion; no calendar events were created.`;
    if (q.includes("review")) {
      const review = weeklyReview(state);
      return `Last 7 days (${review.start} to ${review.end}):\n• ${review.tasksCompleted} tasks completed\n• ${review.assignmentsCompleted} assignments/exams completed\n• ${review.sessions} workouts\n• ${review.workload.length} school deadlines pending (including overdue)\n• ${review.stepAverage === null ? "No steps logged" : Math.round(review.stepAverage) + " steps per logged day"}\n• ${review.habitCompleted}/${review.habitPossible} habit check-ins${review.legacyCompletions ? "\nEarlier completed records without a completion date are excluded." : ""}`;
    }
    if (q.includes("priorit") || q.includes("today"))
      return `Start with ${
        tasks
          .slice(0, 3)
          .map((t) => t.name)
          .join(" and ") || "your most important unfinished task"
      }. ${assignments[0] ? `Your next college deadline is ${assignments[0].name} on ${assignments[0].due}.` : ""}\nKeep your plan realistic and leave a little breathing room.`;
    return "This is a local preview, without an AI model or API. Try asking about today’s priorities, assignments, weight, bench press, tomorrow’s schedule, or your weekly review.";
  },
};
