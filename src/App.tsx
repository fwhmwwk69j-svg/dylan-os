import { useWorkspace } from "./application/useWorkspace";
import { useWorkspacePresence } from "./application/useWorkspacePresence";
import {
  saveFormCommand,
  formSnapshotReason,
  isFormKind,
  deleteRecord,
  courseNotes,
  toggleWorkout,
} from "./application/commands";
import { preferences } from "./persistence/preferences";
import { CURRENT_ROUTES } from "./platform/modules";
import Planner from "./Planner";
import TodayPlanning from "./TodayPlanning";
import FitnessGoalsEditor, { GoalProgress } from "./FitnessGoals";
import ReflectionEditor from "./ReflectionEditor";
import CourseNotes from "./CourseNotes";
import {
  createContext,
  useContext,
  lazy,
  Suspense,
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Sun,
  GraduationCap,
  Dumbbell,
  CheckCheck,
  Sparkles,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Moon,
  ChevronRight,
  Check,
  X,
  Flame,
  CalendarDays,
  ArrowDownRight,
  Send,
  Menu,
  Target,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import {
  day,
  toggleTask,
  averageWeight,
  sessionCount,
  localAssistant,
  type State,
  type Task,
  type Assignment,
} from "./data";
import {
  urgency,
  dueTasks,
  schoolWorkload,
  toggleAssignment,
  toggleHabit,
} from "./personal";
import DashboardSettings from "./DashboardSettings";
import HabitHistory from "./HabitHistory";
import FitnessHistory from "./FitnessHistory";
import {
  dashboardPreferences,
  scheduled,
  habitComplete,
  habitCount,
  habitPlan,
  habitStreak,
  habitWeek,
  setHabitCount,
  backupReminder,
  type ExportStatus,
} from "./daily";
import DataBackup from "./DataBackup";
import WeeklyReview from "./WeeklyReview";
const WeightChart = lazy(() => import("./Charts"));
const BenchChart = lazy(() =>
  import("./Charts").then((module) => ({ default: module.BenchChart })),
);
type Page =
  | "Today"
  | "College"
  | "Fitness"
  | "Tasks"
  | "AI Assistant"
  | "Habits"
  | "Weekly Planner"
  | "Weekly Review"
  | "Data & Backup";
const routeIcons = {
  Today: Sun,
  "Weekly Planner": CalendarDays,
  College: GraduationCap,
  Fitness: Dumbbell,
  Tasks: CheckCheck,
  "AI Assistant": Sparkles,
  "Data & Backup": ShieldCheck,
};
const navigation = CURRENT_ROUTES.map((route) => ({
  name: route.name as Page,
  icon: routeIcons[route.name],
}));
const formatDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
function Urgency({
  due,
  completed = false,
}: {
  due: string;
  completed?: boolean;
}) {
  const status = urgency(due, completed);
  return status ? (
    <span className={`urgency ${status.level}`}>{status.label}</span>
  ) : null;
}
const DashboardContext = createContext<ReturnType<
  typeof dashboardPreferences
> | null>(null);
const CARD_IDS: Record<string, string> = {
  "Needs your attention": "priorities",
  "Overdue tasks": "overdue",
  "Today’s tasks": "tasks",
  "Upcoming assignments": "assignments",
  "Upcoming exams": "exams",
  "Today’s workout": "workout",
  "Small habits. Big impact.": "habits",
  "Weight trend": "fitness",
  "On the horizon": "dates",
};
function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const preferences = useContext(DashboardContext);
  const key = CARD_IDS[title];
  if (preferences && key && preferences.hidden.includes(key)) return null;
  return (
    <section
      className={`card ${className}`}
      style={
        preferences && key
          ? { order: preferences.order.indexOf(key as never) }
          : undefined
      }
    >
      <div className="card-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export default function App() {
  const dialogRef = useRef<HTMLElement>(null);
  const workspace = useWorkspace();
  const {
    data,
    ready,
    loadError,
    undo,
    conflict,
    notice,
    setNotice,
    update,
    undoLast,
    dismissUndo,
    repository,
  } = workspace;
  const otherTabs = useWorkspacePresence();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editLogDate, setEditLogDate] = useState<string | null>(null);
  const [editWorkoutId, setEditWorkoutId] = useState<string | null>(null);
  const [backupDismissed, setBackupDismissed] = useState(() => {
    try {
      return preferences.reminder();
    } catch {
      return 0;
    }
  });
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(() => {
    try {
      return preferences.exportInfo().status;
    } catch {
      return null;
    }
  });
  useEffect(() => preferences.subscribeExports(setExportStatus), []);
  const [editHabit, setEditHabit] = useState<number | null>(null);
  const [editDate, setEditDate] = useState<number | null>(null);
  const [habitDate, setHabitDate] = useState(day());
  const [pendingSchool, setPendingSchool] = useState<Assignment["type"] | null>(
    null,
  );
  const [assignmentType, setAssignmentType] =
    useState<Assignment["type"]>("Assignment");
  const [, refreshDate] = useState(day());
  const [page, setPage] = useState<Page>("Today");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [modal, setModal] = useState<
    | "task"
    | "course"
    | "assignment"
    | "weight"
    | "workout"
    | "nutrition"
    | "quick"
    | "habit"
    | "habitCompletion"
    | "dashboard"
    | "date"
    | null
  >(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [taskFilter, setTaskFilter] = useState("All");
  const [theme, setTheme] = useState(() => {
    try {
      return preferences.theme();
    } catch {
      return "light";
    }
  });
  const [menu, setMenu] = useState(false);
  const [formError, setFormError] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>(
    [],
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFormError("");
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled"));
    (
      focusable().find((el) => el.tagName === "INPUT") || focusable()[0]
    )?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
      if (e.key === "Tab") {
        const nodes = focusable();
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal]);
  useEffect(() => {
    const timer = setInterval(() => refreshDate(day()), 60000);
    return () => clearInterval(timer);
  }, []);
  document.documentElement.dataset.theme = theme;
  async function deleteRecords(next: State, label: string) {
    if (await workspace.remove(next, label)) {
      closeModal();
      setCourseId(null);
    }
  }
  async function reloadLatest() {
    if (
      (modal ||
        courseId ||
        ["Weekly Planner", "Weekly Review", "Fitness"].includes(page)) &&
      !window.confirm(
        "Reload the latest workspace? Unsaved form text or course notes will be discarded.",
      )
    )
      return;
    if (await workspace.reload()) {
      setReloadVersion((version) => version + 1);
      closeModal();
      setCourseId(null);
      setMessages([]);
    } else
      setNotice(
        "Latest saved data could not be loaded. Use Data & Backup for recovery.",
      );
  }

  function navigate(next: Page) {
    setPage(next);
    setCourseId(null);
    setMenu(false);
  }
  const todayTasks = data.tasks.filter((t) => t.due === day() && !t.completed);
  const dashboard = dashboardPreferences(data);
  const selectedPriorities = dashboard.priorities
    .map((id) => data.tasks.find((t) => t.id === id && !t.completed))
    .filter((t): t is Task => !!t);
  const priorities = selectedPriorities.length
    ? selectedPriorities
    : dueTasks(data);
  const overdueTasks = dueTasks(data).filter((t) => t.due < day());
  const deadlines = [...data.assignments]
    .filter((a) => !a.completed)
    .sort((a, b) => a.due.localeCompare(b.due));
  const todaySchool = schoolWorkload(data, day(), 14);
  const upcomingAssignments = todaySchool.filter(
    (a) => a.type === "Assignment",
  );
  const upcomingExams = todaySchool.filter((a) => a.type === "Exam");
  const weights = [...data.weights].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const weight = weights.at(-1)?.value ?? null;
  const avg = averageWeight(weights);
  const previousAvg = averageWeight(weights, day(-7));
  const nutrition = data.nutrition.find((n) => n.date === day()) || {
    date: day(),
    calories: 0,
    protein: 0,
    steps: 0,
  };
  const todaysWorkout = data.workouts.filter((w) => w.date === day());
  const completedWorkouts = data.workouts.filter((w) => w.completed);
  const scheduledHabits = data.habits.filter((h) => scheduled(h));
  const habitsDone = scheduledHabits.filter((h) => habitComplete(h)).length;
  const selectedCourse = data.courses.find((c) => c.id === courseId);
  const bench = completedWorkouts
    .filter((w) => w.exercise.toLowerCase().includes("bench"))
    .sort((a, b) => a.date.localeCompare(b.date));
  function taskRow(t: Task) {
    return (
      <div
        className={`task-row ${t.completed ? "done" : ""} ${urgency(t.due, t.completed)?.level || ""}`}
        key={t.id}
      >
        <button
          className="checkbox"
          aria-label={`${t.completed ? "Reopen" : "Complete"} ${t.name}`}
          onClick={() => update(toggleTask(data, t.id))}
        >
          {t.completed && <Check size={13} />}
        </button>
        <div className="row-grow">
          <button
            className="text-button task-title"
            onClick={() => {
              setEditTask(t);
              setModal("task");
            }}
          >
            {t.name}
          </button>
          <div className="row-meta">
            {t.category} {t.recurring && "· Daily recurring"} ·{" "}
            {formatDate(t.due)}
            <Urgency due={t.due} completed={t.completed} />
          </div>
        </div>
        <span className={`priority ${t.priority.toLowerCase()}`}>
          {t.priority}
        </span>
      </div>
    );
  }
  function assignmentRow(a: Assignment) {
    const course = data.courses.find((c) => c.id === a.courseId);
    return (
      <div
        className={`assignment-row ${urgency(a.due, a.completed)?.level || ""}`}
        key={a.id}
      >
        <div className="date-tile">
          <strong>{new Date(a.due + "T12:00:00").getDate()}</strong>
          <span>
            {new Date(a.due + "T12:00:00").toLocaleDateString("en-US", {
              month: "short",
            })}
          </span>
        </div>
        <div className="row-grow">
          <button
            className="text-button task-title"
            onClick={() => {
              setEditAssignment(a);
              setModal("assignment");
            }}
          >
            {a.name}
          </button>
          <div className="row-meta">
            {course?.code} · {a.type}
            <Urgency due={a.due} completed={a.completed} />
            {a.grade != null && <span> · {a.grade}%</span>}
            {a.notes && <p className="row-meta">{a.notes}</p>}
          </div>
        </div>
        <button
          className={`checkbox ${a.completed ? "checked" : ""}`}
          aria-label={`${a.completed ? "Reopen" : "Complete"} ${a.name}`}
          onClick={() => update(toggleAssignment(data, a.id))}
        >
          {a.completed && <Check size={13} />}
        </button>
      </div>
    );
  }
  function weightChart() {
    return (
      <Suspense fallback={<div className="chart muted">Loading chart…</div>}>
        {weights.length ? (
          <WeightChart weights={weights} />
        ) : (
          <Empty>Log your first weight to start tracking progress.</Empty>
        )}
      </Suspense>
    );
  }
  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const response = await localAssistant.reply(q, data);
      setMessages((m) => [...m, { role: "assistant", text: response }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Unable to create a response. Please try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }
  async function saveForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isFormKind(modal)) return;
    const f = new FormData(e.currentTarget);
    const selection = {
      taskId: editTask?.id,
      courseId: selectedCourse?.id,
      assignmentId: editAssignment?.id,
      logDate: editLogDate ?? undefined,
      workoutId: editWorkoutId ?? undefined,
      habitId: editHabit === null ? undefined : data.habits[editHabit]?.id,
      dateId: editDate === null ? undefined : data.dates[editDate]?.id,
    };
    try {
      const next = saveFormCommand(data, modal, f, selection);
      if (!(await update(next, formSnapshotReason(data, modal, f, selection))))
        return;
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }
    if (modal === "course" && pendingSchool) {
      setAssignmentType(pendingSchool);
      setPendingSchool(null);
      setModal("assignment");
      return;
    }
    closeModal();
    setEditTask(null);
    setEditAssignment(null);
  }
  function closeModal() {
    setModal(null);
    setPendingSchool(null);
    setEditLogDate(null);
    setEditWorkoutId(null);
  }
  const addTask = () => {
    setEditTask(null);
    setModal("task");
  };
  const addAssignment = (type: Assignment["type"] = "Assignment") => {
    setEditAssignment(null);
    if (!data.courses.length) {
      setPendingSchool(type);
      setCourseId(null);
      setNotice(
        "Add your course first; your assignment or exam form opens next.",
      );
      setModal("course");
      return;
    }
    setAssignmentType(type);
    setEditAssignment(null);
    setModal("assignment");
  };
  if (!ready)
    return (
      <div className="app">
        <p className="muted">Loading workspace…</p>
      </div>
    );
  return (
    <div className="app">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Today");
          }}
        >
          <span className="brand-mark">
            d<span>·</span>
          </span>
          <span>
            Dylan<span className="brand-os">OS</span>
          </span>
        </a>
        <div className="workspace-label">YOUR PERSONAL SPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.name}
              aria-label={n.name}
              className={`nav-item ${page === n.name || (page === "Weekly Review" && n.name === "Today") ? "active" : ""}`}
              onClick={() => navigate(n.name)}
            >
              <n.icon size={19} />
              {n.name}
              {n.name === "Today" && <span className="nav-dot" />}
              {n.name === "AI Assistant" && (
                <span className="small-tag">V1</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="little-spark">✦</span>
            <strong>A little better, every day.</strong>
            <p>Make space for what matters.</p>
          </div>
          <button
            className="theme-button"
            onClick={() => {
              const next = theme === "light" ? "dark" : "light";
              setTheme(next);
              try {
                preferences.saveTheme(next);
              } catch {
                setNotice("Theme changes cannot be saved on this browser.");
              }
            }}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}{" "}
            {theme === "light" ? "Dark" : "Light"} mode
          </button>
          <div className="profile">
            <div className="avatar">D</div>
            <div>
              <strong>Dylan</strong>
              <span>Personal workspace</span>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <main>
        <header className="topbar">
          <div>
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              My workspace <ChevronRight size={13} /> <strong>{page}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-status">
              <span className="online-dot" /> Local workspace
            </span>
            <button
              className="icon-button"
              aria-label="Quick add"
              onClick={() => setModal("quick")}
            >
              <Plus size={19} />
            </button>
            <div className="avatar small">D</div>
          </div>
        </header>
        <div className="content">
          {(otherTabs > 0 || conflict) && (
            <div className="banner" role="status">
              {conflict
                ? "This workspace changed in another tab. Your edits are blocked until you reload the latest records."
                : `Dylan OS is open in ${otherTabs + 1} tabs. Edits are coordinated to prevent overwrites.`}
              {conflict && (
                <button className="secondary" onClick={reloadLatest}>
                  Reload latest workspace
                </button>
              )}
            </div>
          )}
          {backupReminder(exportStatus, backupDismissed) && (
            <div className="backup-nudge">
              <span>
                {exportStatus?.confirmedAt
                  ? "Your weekly external backup is overdue."
                  : "Keep a JSON backup outside this browser."}
              </span>
              <button
                className="subtle-link"
                onClick={() => navigate("Data & Backup")}
              >
                Review backup
              </button>
              <button
                className="subtle-link"
                onClick={() => {
                  const until = Date.now() + 86400000;
                  try {
                    preferences.dismiss(until);
                    setBackupDismissed(until);
                  } catch {
                    setNotice("Reminder dismissal could not be saved.");
                  }
                }}
              >
                Dismiss for today
              </button>
            </div>
          )}
          {notice && (
            <div role="alert" className="banner">
              {notice}
            </div>
          )}
          {page === "Today" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {new Date()
                      .toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                      .toUpperCase()}
                  </div>
                  <h1>
                    Make today count<span className="heading-dot">.</span>
                  </h1>
                  <p>A clear mind. A little momentum. Your day, at a glance.</p>
                </div>
                <div className="heading-actions">
                  <button
                    className="secondary"
                    onClick={() => setModal("dashboard")}
                  >
                    Customize Today
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setPage("Weekly Review")}
                  >
                    Weekly review
                  </button>
                  <button className="primary" onClick={() => setModal("quick")}>
                    <Plus size={17} /> Quick add
                  </button>
                </div>
              </div>
              <div className="focus-banner">
                <div className="focus-icon">
                  <Sun size={27} />
                </div>
                <div>
                  <div className="eyebrow">YOUR DAILY FOCUS</div>
                  <h3>Progress over perfection.</h3>
                  <p>Show up for the things that move you forward.</p>
                </div>
                <Sun
                  size={128}
                  strokeWidth={0.8}
                  className="focus-art"
                  aria-hidden="true"
                />
              </div>
              <div className="daily-overview">
                <span>
                  {upcomingAssignments.length} assignments ·{" "}
                  {upcomingExams.length} exams approaching
                </span>
                <span>
                  {todaysWorkout.reduce((total, w) => total + (w.sets ?? 1), 0)}{" "}
                  workout sets today
                </span>
                <span>{scheduledHabits.length} habits scheduled</span>
              </div>
              <TodayPlanning
                data={data}
                onPlanner={() => navigate("Weekly Planner")}
              />
              <GoalProgress data={data} />
              <div className="stat-grid">
                <div className="stat">
                  <span>
                    <CheckCheck size={16} /> Today’s tasks
                  </span>
                  <strong>
                    {todayTasks.length}
                    <small>to go</small>
                  </strong>
                  <p>
                    {
                      data.tasks.filter(
                        (t) => t.completedOn === day() && t.completed,
                      ).length
                    }{" "}
                    completed today · {overdueTasks.length} overdue
                  </p>
                </div>
                <div className="stat">
                  <span>
                    <GraduationCap size={16} /> College deadlines
                  </span>
                  <strong>
                    {schoolWorkload(data).length}
                    <small>this week</small>
                  </strong>
                  <p>
                    {deadlines[0]
                      ? `Next up: ${formatDate(deadlines[0].due)}`
                      : "All caught up"}
                  </p>
                </div>
                <div className="stat">
                  <span>
                    <Target size={16} /> Current weight
                  </span>
                  <strong>
                    {weight ?? "—"}
                    <small>lb</small>
                  </strong>
                  <p className="green">
                    <ArrowDownRight size={13} />
                    {avg && previousAvg
                      ? `${(avg - previousAvg).toFixed(1)} lb vs. last week’s average`
                      : "Log weights to see your trend"}
                  </p>
                </div>
                <div className="stat">
                  <span>
                    <Flame size={16} /> Daily habits
                  </span>
                  <strong>
                    {habitsDone}
                    <small>/ {scheduledHabits.length}</small>
                  </strong>
                  <p>Your small wins add up</p>
                </div>
              </div>
              <DashboardContext.Provider value={dashboard}>
                <div
                  className={`today-grid ${data.preferences?.dashboard?.order ? "personalized-grid" : ""}`}
                >
                  <div className="column">
                    <Card
                      title="Needs your attention"
                      subtitle={
                        selectedPriorities.length
                          ? "Your chosen focus for today."
                          : "Overdue first, then today’s tasks by priority."
                      }
                      action={<span className="pill">FOCUS</span>}
                    >
                      <div className="priorities">
                        {priorities.slice(0, 3).map((t, i) => (
                          <div className="priority-row" key={t.id}>
                            <span className="priority-number">0{i + 1}</span>
                            <div>
                              <strong>{t.name}</strong>
                              <p>
                                {t.category} · {formatDate(t.due)}{" "}
                                <Urgency due={t.due} />
                              </p>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`Complete ${t.name}`}
                              onClick={() => update(toggleTask(data, t.id))}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </div>
                        ))}
                        {!priorities.length && (
                          <Empty>
                            No tasks due or overdue. Add your next intention.
                          </Empty>
                        )}
                      </div>
                    </Card>
                    {overdueTasks.length > 0 && (
                      <Card
                        title="Overdue tasks"
                        subtitle="Still open. Complete or reschedule these first."
                      >
                        {overdueTasks.map(taskRow)}
                      </Card>
                    )}
                    <Card
                      title="Today’s tasks"
                      action={
                        <button
                          className="subtle-link"
                          onClick={() => navigate("Tasks")}
                        >
                          View all <ArrowUpRight size={14} />
                        </button>
                      }
                    >
                      {data.tasks.filter((t) => t.due === day()).map(taskRow)}
                      {!data.tasks.some((t) => t.due === day()) && (
                        <Empty>Your day is open. Add your first task.</Empty>
                      )}
                      <button className="add-inline" onClick={addTask}>
                        <Plus size={15} /> Add a task
                      </button>
                    </Card>
                    <Card
                      title="Upcoming assignments"
                      subtitle="Next 14 days, plus overdue assignments."
                      action={
                        <button
                          className="subtle-link"
                          onClick={() => navigate("College")}
                        >
                          View all <ArrowUpRight size={14} />
                        </button>
                      }
                    >
                      {upcomingAssignments.map(assignmentRow)}
                      {!deadlines.length && (
                        <Empty>No pending assignments.</Empty>
                      )}
                    </Card>
                    <Card
                      title="Upcoming exams"
                      subtitle="Next 14 days, plus overdue exams."
                      action={
                        <button
                          className="subtle-link"
                          onClick={() => addAssignment("Exam")}
                        >
                          <Plus size={14} /> Exam
                        </button>
                      }
                    >
                      {upcomingExams.map(assignmentRow)}
                      {!upcomingExams.length && (
                        <Empty>No exams due in the next 14 days.</Empty>
                      )}
                    </Card>
                  </div>
                  <div className="column">
                    <Card
                      title="Today’s workout"
                      action={<Dumbbell size={19} className="muted" />}
                    >
                      {todaysWorkout.map((w) => (
                        <div key={w.id} className="workout-preview">
                          <span className="pill">STRENGTH</span>
                          <h3>{w.name}</h3>
                          <p>
                            {w.exercise} · {w.sets ?? 1} × {w.weight} lb ×{" "}
                            {w.reps} reps
                          </p>
                          <button
                            className={w.completed ? "secondary" : "primary"}
                            onClick={() => update(toggleWorkout(data, w.id))}
                          >
                            {w.completed ? (
                              <>
                                <Check size={15} /> Completed
                              </>
                            ) : (
                              <>
                                Complete workout <ArrowUpRight size={15} />
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                      {!todaysWorkout.length && (
                        <>
                          <Empty>Rest or train — make it intentional.</Empty>
                          <button
                            className="secondary"
                            onClick={() => setModal("workout")}
                          >
                            Log a workout
                          </button>
                        </>
                      )}
                    </Card>
                    <Card
                      title="Small habits. Big impact."
                      subtitle="A little consistency goes a long way."
                      action={
                        <div className="heading-actions">
                          <button
                            className="subtle-link"
                            onClick={() => navigate("Habits")}
                          >
                            History
                          </button>
                          <button
                            className="subtle-link"
                            onClick={() => {
                              setEditHabit(null);
                              setModal("habit");
                            }}
                          >
                            <Plus size={14} /> Habit
                          </button>
                        </div>
                      }
                    >
                      {data.habits.map((h, i) => (
                        <div className="habit-row" key={h.name}>
                          <button
                            className={`checkbox ${habitComplete(h) ? "checked" : ""}`}
                            aria-label={`Toggle ${h.name}`}
                            disabled={!scheduled(h)}
                            onClick={() => update(toggleHabit(data, i))}
                          >
                            {habitComplete(h) && <Check size={13} />}
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              setEditHabit(i);
                              setModal("habit");
                            }}
                          >
                            {h.name}
                          </button>
                          <span className="row-meta">
                            {scheduled(h)
                              ? `${habitCount(h)}/${habitPlan(h, day()).target} · ${habitStreak(h)} day streak · ${habitWeek(h).percent ?? 0}% this week`
                              : "Rest day"}
                          </span>
                          {scheduled(h) && (
                            <button
                              className="subtle-link"
                              aria-label={`Add progress ${h.name}`}
                              onClick={() =>
                                update(
                                  setHabitCount(
                                    data,
                                    i,
                                    Math.min(100, habitCount(h) + 1),
                                  ),
                                )
                              }
                            >
                              +1
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="progress-track">
                        <div
                          style={{
                            width: `${(habitsDone / (scheduledHabits.length || 1)) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="progress-caption">
                        {habitsDone} of {scheduledHabits.length} scheduled
                        habits complete{" "}
                        <span>
                          {Math.round(
                            (habitsDone / (scheduledHabits.length || 1)) * 100,
                          )}
                          %
                        </span>
                      </div>
                    </Card>
                    <Card
                      title="Weight trend"
                      action={
                        <button
                          className="subtle-link"
                          onClick={() => setModal("weight")}
                        >
                          Log weight
                        </button>
                      }
                    >
                      <div className="mini-stat">
                        <strong>
                          {avg ? avg.toFixed(1) : "—"} <small>lb</small>
                        </strong>
                        <span>7-day average</span>
                      </div>
                      {weightChart()}
                      <div className="important-date">
                        <span>Goal weight</span>
                        <strong>
                          {data.goalWeight === null
                            ? "Not set"
                            : `${data.goalWeight} lb`}
                        </strong>
                      </div>
                      <div className="important-date">
                        <span>Today’s steps</span>
                        <strong>
                          {data.nutrition.some((n) => n.date === day())
                            ? nutrition.steps.toLocaleString()
                            : "Not logged"}
                        </strong>
                      </div>
                      <div className="important-date">
                        <span>Workouts · last 7 days</span>
                        <strong>
                          {sessionCount(
                            completedWorkouts.filter(
                              (w) => w.date >= day(-6) && w.date <= day(),
                            ),
                          )}
                        </strong>
                      </div>
                    </Card>
                    <Card
                      title="On the horizon"
                      action={
                        <button
                          className="subtle-link"
                          onClick={() => {
                            setEditDate(null);
                            setModal("date");
                          }}
                        >
                          <Plus size={14} /> Date
                        </button>
                      }
                    >
                      {data.dates
                        .map((d, i) => ({ ...d, index: i }))
                        .filter((d) => d.date >= day())
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map((d) => (
                          <div className="important-date" key={d.index}>
                            <button
                              className="text-button"
                              onClick={() => {
                                setEditDate(d.index);
                                setModal("date");
                              }}
                            >
                              {d.name}
                            </button>
                            <strong>
                              {formatDate(d.date)} <Urgency due={d.date} />
                            </strong>
                          </div>
                        ))}
                      {!data.dates.some((d) => d.date >= day()) && (
                        <Empty>
                          Add a birthday, break, or important deadline.
                        </Empty>
                      )}
                    </Card>
                  </div>
                </div>
              </DashboardContext.Provider>
            </>
          )}
          {page === "Habits" && (
            <HabitHistory
              data={data}
              onEdit={(index) => {
                setEditHabit(index);
                setModal("habit");
              }}
              onToday={() => navigate("Today")}
            />
          )}
          {page === "Data & Backup" && (
            <DataBackup
              repository={repository}
              data={data}
              loadError={loadError}
              onReplace={async (next, reason) => {
                if (await update(next, reason, true)) {
                  dismissUndo();
                  setMessages([]);
                  return true;
                }
                return false;
              }}
              onClear={async (phrase) => {
                const ok = await workspace.clear(phrase);
                if (ok) {
                  dismissUndo();
                  setMessages([]);
                }
                return ok;
              }}
              onExportChange={setExportStatus}
            />
          )}
          {page === "Weekly Planner" && (
            <Planner
              key={reloadVersion}
              data={data}
              onChange={update}
              onDelete={deleteRecords}
              onToday={() => navigate("Today")}
              onOpen={(kind, id) => {
                if (kind === "task") {
                  setEditTask(data.tasks.find((t) => t.id === id) ?? null);
                  setModal("task");
                }
                if (kind === "school") {
                  setEditAssignment(
                    data.assignments.find((a) => a.id === id) ?? null,
                  );
                  setModal("assignment");
                }
                if (kind === "workout") {
                  setEditWorkoutId(id);
                  setModal("workout");
                }
              }}
            />
          )}
          {page === "Weekly Review" && (
            <WeeklyReview
              data={data}
              onToday={() => navigate("Today")}
              onFitness={() => navigate("Fitness")}
              reflection={
                <ReflectionEditor
                  key={reloadVersion}
                  data={data}
                  onChange={update}
                  onDelete={deleteRecords}
                />
              }
            />
          )}
          {page === "College" && (
            <>
              <div className="page-heading">
                <div>
                  {selectedCourse && (
                    <button
                      className="subtle-link back"
                      onClick={() => setCourseId(null)}
                    >
                      <ArrowLeft size={15} /> All courses
                    </button>
                  )}
                  <div className="eyebrow">LEARN WITH INTENTION</div>
                  <h1>
                    {selectedCourse
                      ? selectedCourse.name
                      : "Your next chapter."}
                  </h1>
                  <p>
                    {selectedCourse
                      ? `${selectedCourse.code} · ${selectedCourse.instructor}`
                      : "A little structure for the bigger picture."}
                  </p>
                </div>
                <button className="primary" onClick={() => setModal("course")}>
                  <Plus size={16} />
                  {selectedCourse ? "Edit course" : "Add course"}
                </button>
              </div>
              {!selectedCourse ? (
                <>
                  {data.courses.length > 0 && (
                    <p className="tip">
                      Open a course to edit its details, grades, and notes.
                      Delete unwanted courses from Edit course; linked
                      assignments and exams are removed with confirmation.
                    </p>
                  )}
                  {!data.courses.length && (
                    <section className="card onboarding">
                      <GraduationCap size={25} />
                      <h2>Make college your own.</h2>
                      <p>
                        Add your course name and code, then enter assignments,
                        exams, grades, and notes from its page. Deadlines flow
                        straight into Today.
                      </p>
                      <button
                        className="primary"
                        onClick={() => setModal("course")}
                      >
                        Add your first course
                      </button>
                    </section>
                  )}
                  <div className="course-grid">
                    {data.courses.map((c, i) => (
                      <button
                        className={`course-card course-${i % 3}`}
                        key={c.id}
                        onClick={() => setCourseId(c.id)}
                      >
                        <div>
                          <span className="pill">{c.code}</span>
                          <ArrowUpRight size={20} />
                        </div>
                        <GraduationCap size={30} />
                        <h2>{c.name}</h2>
                        <p>{c.instructor}</p>
                        <footer>
                          <span>
                            {
                              data.assignments.filter(
                                (a) => a.courseId === c.id && !a.completed,
                              ).length
                            }{" "}
                            upcoming
                          </span>
                          <strong>
                            {c.grade === null ? "Not graded" : `${c.grade}%`}{" "}
                            <small>{c.grade === null ? "" : "grade"}</small>
                          </strong>
                        </footer>
                      </button>
                    ))}
                  </div>
                  <div className="two-grid">
                    <Card
                      title="Upcoming deadlines"
                      subtitle="Stay a step ahead."
                      action={
                        <button
                          className="subtle-link"

                          onClick={() => addAssignment()}
                        >
                          <Plus size={15} /> Assignment
                        </button>
                      }
                    >
                      {deadlines.map(assignmentRow)}
                      {!deadlines.length && (
                        <Empty>
                          Nothing pending. Enjoy the breathing room.
                        </Empty>
                      )}
                    </Card>
                    <Card title="Exams & completed work">
                      {data.assignments
                        .filter((a) => a.type === "Exam" || a.completed)
                        .map(assignmentRow)}
                      {!data.assignments.some(
                        (a) => a.type === "Exam" || a.completed,
                      ) && (
                        <Empty>No exams or completed assignments yet.</Empty>
                      )}
                    </Card>
                  </div>
                </>
              ) : (
                <div className="two-grid">
                  <Card
                    title="Assignments & exams"
                    action={
                      <button
                        className="subtle-link"
                        onClick={() => addAssignment()}
                      >
                        <Plus size={15} /> Add
                      </button>
                    }
                  >
                    {data.assignments
                      .filter((a) => a.courseId === courseId)
                      .sort((a, b) => a.due.localeCompare(b.due))
                      .map(assignmentRow)}
                    {!data.assignments.some((a) => a.courseId === courseId) && (
                      <Empty>Add your first assignment.</Empty>
                    )}
                  </Card>
                  <div className="column">
                    <Card title="Current grade">
                      <div className="big-number">
                        {selectedCourse.grade ?? "—"}
                        <small>
                          {selectedCourse.grade === null ? "" : "%"}
                        </small>
                      </div>
                      <p className="muted">
                        Manually recorded course grade. Edit the course to
                        update.
                      </p>
                    </Card>
                    <Card title="Course notes">
                      <CourseNotes
                        key={selectedCourse.id}
                        notes={selectedCourse.notes}
                        onSave={(notes) =>
                          update(
                            courseNotes(data, selectedCourse.id, notes),
                            "Before editing course notes",
                          )
                        }
                      />
                    </Card>
                  </div>
                </div>
              )}
            </>
          )}
          {page === "Fitness" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BUILD YOUR STRONGER SELF</div>
                  <h1>Show up. Get stronger.</h1>
                  <p>Track the work. Celebrate the progress.</p>
                </div>
                <button className="primary" onClick={() => setModal("workout")}>
                  <Plus size={16} /> Log workout
                </button>
              </div>
              <FitnessGoalsEditor
                key={reloadVersion}
                data={data}
                onChange={update}
              />
              <div className="stat-grid">
                <div className="stat">
                  <span>Body weight</span>
                  <strong>
                    {weight ?? "—"}
                    <small>lb</small>
                  </strong>
                  <button
                    className="subtle-link"
                    onClick={() => setModal("weight")}
                  >
                    Log weight <Plus size={13} />
                  </button>
                </div>
                <div className="stat">
                  <span>7-day average</span>
                  <strong>
                    {avg ? avg.toFixed(1) : "—"}
                    <small>lb</small>
                  </strong>
                  <p>
                    {avg && previousAvg
                      ? `${(avg - previousAvg).toFixed(1)} lb from prior 7 days`
                      : "More entries needed to compare weeks"}
                  </p>
                </div>
                <div className="stat">
                  <span>Goal weight</span>
                  <strong>
                    {data.goalWeight ?? "—"}
                    <small>lb</small>
                  </strong>
                  <p>
                    {weight !== null && data.goalWeight !== null
                      ? `${Math.abs(weight - data.goalWeight).toFixed(1)} lb from goal`
                      : "Set a goal when logging weight"}
                  </p>
                </div>
                <div className="stat">
                  <span>Workout consistency</span>
                  <strong>
                    {sessionCount(
                      completedWorkouts.filter(
                        (w) => w.date >= day(-6) && w.date <= day(),
                      ),
                    )}
                    <small>sessions</small>
                  </strong>
                  <p>Completed in the last 7 days</p>
                </div>
              </div>
              <div className="two-grid">
                <Card
                  title="Weight, over time"
                  subtitle="Daily entries · pounds"
                  action={
                    <button
                      className="subtle-link"
                      onClick={() => setModal("weight")}
                    >
                      Log weight <Plus size={14} />
                    </button>
                  }
                >
                  {weightChart()}
                </Card>
                <Card
                  title="Daily fuel & movement"
                  action={
                    <button
                      className="subtle-link"
                      onClick={() => setModal("nutrition")}
                    >
                      Edit <ArrowUpRight size={14} />
                    </button>
                  }
                >
                  <div className="nutrition-row">
                    <span>Calories</span>
                    <strong>
                      {nutrition.calories.toLocaleString()} <small>kcal</small>
                    </strong>
                  </div>
                  <div className="nutrition-row">
                    <span>Protein</span>
                    <strong>
                      {nutrition.protein} <small>g</small>
                    </strong>
                  </div>
                  <div className="nutrition-row">
                    <span>Steps</span>
                    <strong>{nutrition.steps.toLocaleString()}</strong>
                  </div>
                  <p className="row-meta">Today’s manually logged totals.</p>
                </Card>
                <Card
                  title="Bench press progression"
                  subtitle="Completed sets · pounds"
                >
                  <Suspense
                    fallback={<div className="chart muted">Loading chart…</div>}
                  >
                    <BenchChart bench={bench} />
                  </Suspense>
                </Card>
                <Card
                  title="Personal records"
                  subtitle="Heaviest completed set for each exercise."
                >
                  {[...new Set(completedWorkouts.map((w) => w.exercise))].map(
                    (exercise) => {
                      const best = completedWorkouts
                        .filter((w) => w.exercise === exercise)
                        .sort((a, b) => b.weight - a.weight)[0];
                      return (
                        <div className="record" key={exercise}>
                          <span className="record-icon">
                            <TrendingUp size={19} />
                          </span>
                          <div className="row-grow">
                            <strong>{exercise}</strong>
                            <p className="row-meta">
                              {best.reps} reps · {formatDate(best.date)}
                            </p>
                          </div>
                          <strong>
                            {best.weight} <small>lb</small>
                          </strong>
                        </div>
                      );
                    },
                  )}
                  {!completedWorkouts.length && (
                    <Empty>Log a workout to start tracking records.</Empty>
                  )}
                </Card>
              </div>
              <Card
                title="Exercise history"
                subtitle="Every session is a step forward."
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Workout</th>
                        <th>Exercise</th>
                        <th>Set</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.workouts]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((w) => (
                          <tr key={w.id}>
                            <td>{formatDate(w.date)}</td>
                            <td>{w.name}</td>
                            <td>{w.exercise}</td>
                            <td>
                              {w.sets ?? 1} × {w.weight} lb × {w.reps}
                            </td>
                            <td>
                              <button
                                className="pill"
                                disabled={!w.completed && w.date > day()}
                                title={
                                  !w.completed && w.date > day()
                                    ? "Complete on or after the planned date"
                                    : undefined
                                }
                                onClick={() =>
                                  update(toggleWorkout(data, w.id))
                                }
                              >
                                {w.completed ? "Completed" : "Planned"}
                              </button>
                            </td>
                            <td>
                              <button
                                className="secondary"
                                aria-label={`Edit workout ${w.name}`}
                                onClick={() => {
                                  setEditWorkoutId(w.id);
                                  setModal("workout");
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="danger text-button"
                                aria-label={`Delete workout ${w.name}`}
                                onClick={() =>
                                  deleteRecords(
                                    deleteRecord(data, "workouts", w.id),
                                    "workout",
                                  )
                                }
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <FitnessHistory
                data={data}
                onEdit={(kind, date) => {
                  setEditLogDate(date);
                  setModal(kind);
                }}
                onDelete={(kind, date) =>
                  deleteRecords(
                    deleteRecord(
                      data,
                      kind,
                      data[kind].find((x) => x.date === date)!.id!,
                    ),
                    kind === "weights"
                      ? "weight entry"
                      : "nutrition/steps entry",
                  )
                }
              />
            </>
          )}
          {page === "Tasks" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">LESS MENTAL CLUTTER</div>
                  <h1>A place for every to-do.</h1>
                  <p>
                    Keep the important things in sight, and out of your head.
                  </p>
                </div>
                <button className="primary" onClick={addTask}>
                  <Plus size={16} /> New task
                </button>
              </div>
              <div className="task-tabs" role="group" aria-label="Filter tasks">
                {["All", "Today", "Overdue", "Upcoming", "Completed"].map(
                  (f) => (
                    <button
                      className={taskFilter === f ? "selected" : ""}
                      key={f}
                      onClick={() => setTaskFilter(f)}
                    >
                      {f}
                      <span>
                        {
                          data.tasks.filter((t) =>
                            f === "All"
                              ? true
                              : f === "Today"
                                ? t.due === day() && !t.completed
                                : f === "Overdue"
                                  ? t.due < day() && !t.completed
                                  : f === "Upcoming"
                                    ? t.due > day() && !t.completed
                                    : t.completed,
                          ).length
                        }
                      </span>
                    </button>
                  ),
                )}
              </div>
              <Card
                title={
                  taskFilter === "All" ? "All tasks" : `${taskFilter} tasks`
                }
                subtitle="Click a task name to edit its details."
              >
                {data.tasks
                  .filter((t) =>
                    taskFilter === "All"
                      ? true
                      : taskFilter === "Today"
                        ? t.due === day() && !t.completed
                        : taskFilter === "Overdue"
                          ? t.due < day() && !t.completed
                          : taskFilter === "Upcoming"
                            ? t.due > day() && !t.completed
                            : t.completed,
                  )
                  .sort(
                    (a, b) =>
                      Number(a.completed) - Number(b.completed) ||
                      a.due.localeCompare(b.due),
                  )
                  .map(taskRow)}
                {!data.tasks.some((t) =>
                  taskFilter === "All"
                    ? true
                    : taskFilter === "Today"
                      ? t.due === day() && !t.completed
                      : taskFilter === "Overdue"
                        ? t.due < day() && !t.completed
                        : taskFilter === "Upcoming"
                          ? t.due > day() && !t.completed
                          : t.completed,
                ) && <Empty>No tasks in this view.</Empty>}
                <button className="add-inline" onClick={addTask}>
                  <Plus size={15} /> Add a task
                </button>
              </Card>
              <div className="tip">
                <Sparkles size={17} />
                <span>
                  Daily recurring tasks create the next day’s task when
                  completed. Everything stays connected to Today.
                </span>
              </div>
            </>
          )}
          {page === "AI Assistant" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE PERSPECTIVE</div>
                  <h1>Think it through.</h1>
                  <p>Your life in context. Your next step made clearer.</p>
                </div>
                <span className="pill">LOCAL PREVIEW</span>
              </div>
              <div className="assistant-layout">
                <div className="assistant-card">
                  <div className="assistant-intro">
                    <div className="assistant-orb">
                      <Sparkles size={28} />
                    </div>
                    <h2>Your personal thinking partner.</h2>
                    <p>
                      Explore your priorities, college deadlines, and fitness
                      progress in one place.
                    </p>
                    <div className="preview-notice">
                      No AI model or paid API is connected. This preview uses
                      simple rules to read your current local data. It doesn’t
                      change your records.
                    </div>
                  </div>
                  {!messages.length && (
                    <div className="prompt-grid">
                      {[
                        "What should I prioritize today?",
                        "What assignments are coming up?",
                        "How has my weight changed this month?",
                        "How has my bench press progressed?",
                        "Build my schedule for tomorrow.",
                        "Give me my weekly review.",
                      ].map((q) => (
                        <button key={q} onClick={() => ask(q)}>
                          {q}
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="messages" aria-live="polite">
                    {messages.map((m, i) => (
                      <div key={i} className={`message ${m.role}`}>
                        <strong>
                          {m.role === "user"
                            ? "You"
                            : "Dylan OS · local preview"}
                        </strong>
                        <p>{m.text}</p>
                      </div>
                    ))}
                    {busy && <p>Reading your workspace…</p>}
                  </div>
                  <form
                    className="chat-input"
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask(question);
                    }}
                  >
                    <input
                      aria-label="Ask Dylan OS"
                      placeholder="Ask about your day, studies, or progress…"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                    <button
                      className="primary icon-button"
                      aria-label="Send question"
                      disabled={busy || !question.trim()}
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </div>
                <Card
                  title="Connected context"
                  subtitle="One workspace. A clearer picture."
                >
                  {[
                    {
                      icon: CheckCheck,
                      name: "Tasks & priorities",
                      count: data.tasks.length,
                    },
                    {
                      icon: GraduationCap,
                      name: "Courses & assignments",
                      count: data.assignments.length,
                    },
                    {
                      icon: Dumbbell,
                      name: "Fitness & progress",
                      count: data.workouts.length,
                    },
                  ].map((x) => (
                    <div className="context-row" key={x.name}>
                      <x.icon size={19} />
                      <span>{x.name}</span>
                      <span className="online-dot" />
                    </div>
                  ))}
                  <div className="context-note">
                    <strong>Built for what’s next</strong>
                    <p>
                      A provider adapter separates this interface from future AI
                      services. Authentication, private database access, and
                      explicit action approvals can be added behind it.
                    </p>
                  </div>
                </Card>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              Dylan OS <span>·</span> A little better, every day.
            </span>
            <span>V1.5.1 · Your workspace · Stored on this device</span>
          </footer>
        </div>
      </main>
      {undo && (
        <div className="undo-toast" role="status">
          <span>Deleted {undo.label}. Undo available for 30 seconds.</span>
          <button className="secondary" onClick={undoLast}>
            Undo deletion
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss undo"
            onClick={dismissUndo}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => closeModal()}>
          <section
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-heading">
              <h2 id="modal-title">
                {modal === "dashboard"
                  ? "Personalize Today"
                  : modal === "quick"
                    ? "Quick add"
                    : modal === "habitCompletion"
                      ? "Habit check-in"
                      : modal === "habit"
                        ? "Your daily habit"
                        : modal === "date"
                          ? "Important date"
                          : modal === "task"
                            ? editTask
                              ? "Edit task"
                              : "A new intention"
                            : modal === "course"
                              ? selectedCourse
                                ? "Edit course"
                                : "Add a course"
                              : modal === "assignment"
                                ? editAssignment
                                  ? "Edit assignment"
                                  : "Add an assignment"
                                : modal === "weight"
                                  ? "Log your weight"
                                  : modal === "nutrition"
                                    ? "Daily fuel & movement"
                                    : "Log a workout"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => closeModal()}
              >
                <X size={20} />
              </button>
            </div>
            {conflict && (
              <div className="banner" role="alert">
                Another tab changed the workspace. Keep any draft text before
                reloading.{" "}
                <button
                  className="secondary"
                  type="button"
                  onClick={reloadLatest}
                >
                  Reload latest workspace
                </button>
              </div>
            )}
            {formError && (
              <div className="banner" role="alert">
                {formError}
              </div>
            )}
            {modal === "dashboard" ? (
              <>
                <DashboardSettings
                  data={data}
                  onChange={(next) => {
                    update(next, "Before customizing Today");
                  }}
                />
                <button className="primary" onClick={closeModal}>
                  Done
                </button>
              </>
            ) : modal === "quick" ? (
              <div className="quick-grid">
                {[
                  { name: "Task", action: addTask },
                  { name: "Assignment", action: () => addAssignment() },
                  { name: "Exam", action: () => addAssignment("Exam") },
                  { name: "Weight entry", action: () => setModal("weight") },
                  { name: "Workout", action: () => setModal("workout") },
                  {
                    name: "Habit completion",
                    action: () => {
                      setHabitDate(day());
                      setModal("habitCompletion");
                    },
                  },
                ].map((item) => (
                  <button
                    className="secondary"
                    key={item.name}
                    onClick={item.action}
                  >
                    <Plus size={15} />
                    {item.name}
                  </button>
                ))}
              </div>
            ) : modal === "habitCompletion" ? (
              <div>
                <label className="check-in-date">
                  Check-in date
                  <input
                    aria-label="Check-in date"
                    type="date"
                    max={day()}
                    value={habitDate}
                    onChange={(e) => setHabitDate(e.target.value || day())}
                  />
                </label>
                {data.habits
                  .filter((h) => !h.createdOn || h.createdOn <= habitDate)
                  .map((h) => {
                    const i = data.habits.indexOf(h);
                    return (
                      <div className="habit-row" key={h.name}>
                        <button
                          className={`checkbox ${habitComplete(h, habitDate) ? "checked" : ""}`}
                          aria-label={`Toggle ${h.name}`}
                          disabled={!scheduled(h, habitDate)}
                          onClick={() =>
                            update(toggleHabit(data, i, habitDate))
                          }
                        >
                          {habitComplete(h, habitDate) && <Check size={13} />}
                        </button>
                        <span>
                          {h.name} ·{" "}
                          {scheduled(h, habitDate)
                            ? `${habitCount(h, habitDate)}/${habitPlan(h, habitDate).target}`
                            : "Rest day"}
                        </span>
                        <button
                          className="secondary"
                          disabled={!scheduled(h, habitDate)}
                          aria-label={`Add check-in ${h.name}`}
                          onClick={() =>
                            update(
                              setHabitCount(
                                data,
                                i,
                                Math.min(100, habitCount(h, habitDate) + 1),
                                habitDate,
                              ),
                            )
                          }
                        >
                          +1
                        </button>
                      </div>
                    );
                  })}
                {!data.habits.length && (
                  <Empty>Add a habit first to start checking in.</Empty>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    setEditHabit(null);
                    setModal("habit");
                  }}
                >
                  Add a habit
                </button>
                <button className="primary" onClick={() => closeModal()}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={saveForm}>
                {modal === "habit" && (
                  <label>
                    Habit name
                    <input
                      name="name"
                      required
                      maxLength={100}
                      defaultValue={
                        editHabit === null
                          ? ""
                          : (data.habits[editHabit]?.name ?? "")
                      }
                    />
                  </label>
                )}
                {modal === "habit" && (
                  <>
                    <label>
                      Daily target
                      <input
                        name="target"
                        type="number"
                        min="1"
                        max="100"
                        required
                        defaultValue={
                          editHabit === null
                            ? 1
                            : (data.habits[editHabit]?.target ?? 1)
                        }
                      />
                    </label>
                    <fieldset className="habit-schedule">
                      <legend>Scheduled days</legend>
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (name, index) => (
                          <label key={name}>
                            <input
                              name="schedule"
                              type="checkbox"
                              value={index}
                              defaultChecked={
                                editHabit === null
                                  ? true
                                  : (
                                      data.habits[editHabit]?.schedule ?? [
                                        0, 1, 2, 3, 4, 5, 6,
                                      ]
                                    ).includes(index)
                              }
                            />
                            {name}
                          </label>
                        ),
                      )}
                    </fieldset>
                    <p className="row-meta">
                      Changes take effect today; earlier history retains its
                      original schedule.
                    </p>
                  </>
                )}
                {modal === "date" && (
                  <>
                    <label>
                      Name
                      <input
                        name="name"
                        required
                        defaultValue={
                          editDate === null
                            ? ""
                            : (data.dates[editDate]?.name ?? "")
                        }
                      />
                    </label>
                    <label>
                      Date
                      <input
                        name="date"
                        type="date"
                        required
                        defaultValue={
                          editDate === null
                            ? day()
                            : (data.dates[editDate]?.date ?? day())
                        }
                      />
                    </label>
                  </>
                )}
                {modal === "task" && (
                  <>
                    <label>
                      Task name
                      <input
                        name="name"
                        required
                        autoFocus
                        maxLength={150}
                        defaultValue={editTask?.name}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Category
                        <select
                          name="category"
                          defaultValue={editTask?.category || "Personal"}
                        >
                          {["Personal", "College", "Fitness", "Work"].map(
                            (c) => (
                              <option key={c}>{c}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Priority
                        <select
                          name="priority"
                          defaultValue={editTask?.priority || "Medium"}
                        >
                          {["High", "Medium", "Low"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Due date
                      <input
                        name="due"
                        type="date"
                        required
                        defaultValue={editTask?.due || day()}
                      />
                    </label>
                    <label className="check-label">
                      <input
                        name="recurring"
                        type="checkbox"
                        defaultChecked={editTask?.recurring}
                      />{" "}
                      Repeat daily after completion
                    </label>
                  </>
                )}
                {modal === "course" && (
                  <>
                    <label>
                      Course name
                      <input
                        name="name"
                        required
                        autoFocus
                        defaultValue={selectedCourse?.name}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Course code
                        <input
                          name="code"
                          required
                          defaultValue={selectedCourse?.code}
                        />
                      </label>
                      <label>
                        Current grade (%)
                        <input
                          name="grade"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          defaultValue={selectedCourse?.grade ?? ""}
                        />
                      </label>
                    </div>
                    <label>
                      Instructor
                      <input
                        name="instructor"
                        defaultValue={selectedCourse?.instructor}
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        defaultValue={selectedCourse?.notes}
                      />
                    </label>
                  </>
                )}
                {modal === "assignment" && (
                  <>
                    <label>
                      Assignment name
                      <input
                        name="name"
                        required
                        autoFocus
                        defaultValue={editAssignment?.name}
                      />
                    </label>
                    <label>
                      Course
                      <select
                        name="courseId"
                        required
                        defaultValue={
                          editAssignment?.courseId ||
                          courseId ||
                          data.courses[0]?.id
                        }
                      >
                        {data.courses.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Due date
                        <input
                          name="due"
                          type="date"
                          required
                          defaultValue={editAssignment?.due || day(1)}
                        />
                      </label>
                      <label>
                        Type
                        <select
                          name="type"
                          defaultValue={editAssignment?.type || assignmentType}
                        >
                          <option>Assignment</option>
                          <option>Exam</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
                {modal === "assignment" && (
                  <>
                    <label>
                      Grade (%) · optional
                      <input
                        name="grade"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        defaultValue={editAssignment?.grade ?? ""}
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        defaultValue={editAssignment?.notes || ""}
                      />
                    </label>
                  </>
                )}
                {modal === "weight" && (
                  <>
                    <label>
                      Date
                      <input
                        name="date"
                        readOnly={editLogDate !== null}
                        type="date"
                        max={day()}
                        required
                        defaultValue={editLogDate ?? day()}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Weight (lb)
                        <input
                          name="weight"
                          type="number"
                          min="1"
                          max="1500"
                          step="0.1"
                          required
                          defaultValue={
                            data.weights.find((w) => w.date === editLogDate)
                              ?.value ??
                            weight ??
                            ""
                          }
                        />
                      </label>
                      <label>
                        Goal weight (lb)
                        <input
                          name="goal"
                          type="number"
                          min="1"
                          max="1500"
                          step="0.1"
                          defaultValue={data.goalWeight ?? ""}
                        />
                      </label>
                    </div>
                  </>
                )}
                {modal === "workout" && (
                  <>
                    <label>
                      Workout name
                      <input
                        name="name"
                        required
                        autoFocus
                        placeholder="Upper body strength"
                        defaultValue={
                          data.workouts.find((w) => w.id === editWorkoutId)
                            ?.name
                        }
                      />
                    </label>
                    <label>
                      Date
                      <input
                        name="date"

                        type="date"
                        required
                        defaultValue={
                          data.workouts.find((w) => w.id === editWorkoutId)
                            ?.date ?? day()
                        }
                      />
                    </label>
                    <label>
                      Status
                      <select
                        name="status"
                        defaultValue={
                          data.workouts.find((w) => w.id === editWorkoutId)
                            ?.completed === false
                            ? "Planned"
                            : "Completed"
                        }
                      >
                        <option>Completed</option>
                        <option>Planned</option>
                      </select>
                    </label>
                    <label>
                      Exercise
                      <input
                        name="exercise"
                        required
                        placeholder="Bench press"
                        defaultValue={
                          data.workouts.find((w) => w.id === editWorkoutId)
                            ?.exercise
                        }
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Weight (lb)
                        <input
                          name="weight"
                          type="number"
                          min="0"
                          defaultValue={
                            data.workouts.find((w) => w.id === editWorkoutId)
                              ?.weight
                          }
                          step="0.5"
                          required
                        />
                      </label>
                      <label>
                        Reps
                        <input
                          name="reps"
                          type="number"
                          min="1"
                          defaultValue={
                            data.workouts.find((w) => w.id === editWorkoutId)
                              ?.reps
                          }
                          max="1000"
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Sets
                      <input
                        name="sets"
                        type="number"
                        min="1"
                        max="100"
                        required
                        defaultValue={
                          data.workouts.find((w) => w.id === editWorkoutId)
                            ?.sets ?? 1
                        }
                      />
                    </label>
                    <p className="row-meta">
                      Tracks sets for one exercise. Add more entries for
                      additional sets.
                    </p>
                  </>
                )}
                {modal === "nutrition" && (
                  <>
                    <label>
                      Date
                      <input
                        name="date"
                        readOnly={editLogDate !== null}
                        type="date"
                        required
                        max={day()}
                        defaultValue={editLogDate ?? day()}
                      />
                    </label>
                    <label>
                      Calories (kcal)
                      <input
                        name="calories"
                        type="number"
                        min="0"
                        max="20000"
                        required
                        defaultValue={
                          data.nutrition.find((n) => n.date === editLogDate)
                            ?.calories ?? nutrition.calories
                        }
                      />
                    </label>
                    <label>
                      Protein (g)
                      <input
                        name="protein"
                        type="number"
                        min="0"
                        max="2000"
                        required
                        defaultValue={
                          data.nutrition.find((n) => n.date === editLogDate)
                            ?.protein ?? nutrition.protein
                        }
                      />
                    </label>
                    <label>
                      Steps
                      <input
                        name="steps"
                        type="number"
                        min="0"
                        max="200000"
                        required
                        defaultValue={
                          data.nutrition.find((n) => n.date === editLogDate)
                            ?.steps ?? nutrition.steps
                        }
                      />
                    </label>
                  </>
                )}
                <div className="form-actions">
                  {selectedCourse && modal === "course" && (
                    <button
                      type="button"
                      className="danger text-button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${selectedCourse.name} and its linked school work? A snapshot and temporary Undo are available.`,
                          )
                        )
                          deleteRecords(
                            deleteRecord(data, "courses", selectedCourse.id),
                            "course and linked school work",
                          );
                      }}
                    >
                      Delete course
                    </button>
                  )}
                  {editAssignment && modal === "assignment" && (
                    <button
                      type="button"
                      className="danger text-button"
                      onClick={() =>
                        deleteRecords(
                          deleteRecord(data, "assignments", editAssignment.id),
                          "assignment/exam",
                        )
                      }
                    >
                      Delete assignment
                    </button>
                  )}
                  {editHabit !== null &&
                    data.habits[editHabit] &&
                    modal === "habit" && (
                      <button
                        type="button"
                        className="danger text-button"
                        onClick={() =>
                          deleteRecords(
                            deleteRecord(
                              data,
                              "habits",
                              data.habits[editHabit].id!,
                            ),
                            "habit",
                          )
                        }
                      >
                        Delete habit
                      </button>
                    )}
                  {editDate !== null &&
                    data.dates[editDate] &&
                    modal === "date" && (
                      <button
                        type="button"
                        className="danger text-button"
                        onClick={() =>
                          deleteRecords(
                            deleteRecord(
                              data,
                              "dates",
                              data.dates[editDate].id!,
                            ),
                            "important date",
                          )
                        }
                      >
                        Delete date
                      </button>
                    )}
                  {editTask && modal === "task" && (
                    <button
                      type="button"
                      className="danger text-button"
                      onClick={() =>
                        deleteRecords(
                          deleteRecord(data, "tasks", editTask.id),
                          "task",
                        )
                      }
                    >
                      Delete task
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => closeModal()}
                  >
                    Cancel
                  </button>
                  <button className="primary" type="submit">
                    Save {modal === "nutrition" ? "totals" : modal}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
