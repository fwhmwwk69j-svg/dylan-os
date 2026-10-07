import {
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
} from "lucide-react";
import {
  sampleData,
  day,
  uid,
  toggleTask,
  averageWeight,
  sessionCount,
  localAssistant,
  type State,
  type Task,
  type Assignment,
} from "./data";
const WeightChart = lazy(() => import("./Charts"));
const BenchChart = lazy(() =>
  import("./Charts").then((module) => ({ default: module.BenchChart })),
);
type Page = "Today" | "College" | "Fitness" | "Tasks" | "AI Assistant";
const navigation = [
  { name: "Today" as Page, icon: Sun },
  { name: "College" as Page, icon: GraduationCap },
  { name: "Fitness" as Page, icon: Dumbbell },
  { name: "Tasks" as Page, icon: CheckCheck },
  { name: "AI Assistant" as Page, icon: Sparkles },
];
const formatDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
function load(): State {
  try {
    const raw = localStorage.getItem("dylan-os-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed.tasks) &&
        Array.isArray(parsed.courses) &&
        Array.isArray(parsed.weights) &&
        Array.isArray(parsed.assignments) &&
        Array.isArray(parsed.workouts) &&
        Array.isArray(parsed.habits) &&
        Array.isArray(parsed.nutrition) &&
        Array.isArray(parsed.dates)
      )
        return parsed;
    }
  } catch {}
  return sampleData();
}
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
  return (
    <section className={`card ${className}`}>
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
  const [data, setData] = useState<State>(load);
  const [page, setPage] = useState<Page>("Today");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "task" | "course" | "assignment" | "weight" | "workout" | "nutrition" | null
  >(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editAssignment, setEditAssignment] = useState<Assignment | null>(null);
  const [taskFilter, setTaskFilter] = useState("All");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("dylan-theme") || "light",
  );
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>(
    [],
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex="0"]',
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()
      .find((el) => el.tagName === "INPUT")
      ?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setModal(null);
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
  document.documentElement.dataset.theme = theme;
  function update(next: State) {
    setData(next);
    try {
      localStorage.setItem("dylan-os-v1", JSON.stringify(next));
      setNotice("");
    } catch {
      setNotice(
        "Storage is unavailable. Changes will last only for this session.",
      );
    }
  }
  function navigate(next: Page) {
    setPage(next);
    setCourseId(null);
    setMenu(false);
  }
  const todayTasks = data.tasks.filter((t) => t.due === day() && !t.completed);
  const priorities = data.tasks.filter(
    (t) => !t.completed && t.priority === "High" && t.due <= day(),
  );
  const deadlines = data.assignments
    .filter((a) => !a.completed)
    .sort((a, b) => a.due.localeCompare(b.due));
  const weights = [...data.weights].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const weight = weights.at(-1)?.value || 0;
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
  const habitsDone = data.habits.filter((h) => h.dates.includes(day())).length;
  const selectedCourse = data.courses.find((c) => c.id === courseId);
  const bench = completedWorkouts
    .filter((w) => w.exercise.toLowerCase().includes("bench"))
    .sort((a, b) => a.date.localeCompare(b.date));
  function taskRow(t: Task) {
    return (
      <div className={`task-row ${t.completed ? "done" : ""}`} key={t.id}>
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
            {t.due < day() && !t.completed && (
              <span className="overdue"> · Overdue</span>
            )}
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
      <div className="assignment-row" key={a.id}>
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
            {a.due < day() && !a.completed && (
              <span className="overdue"> · Overdue</span>
            )}
          </div>
        </div>
        <button
          className={`checkbox ${a.completed ? "checked" : ""}`}
          aria-label={`${a.completed ? "Reopen" : "Complete"} ${a.name}`}
          onClick={() =>
            update({
              ...data,
              assignments: data.assignments.map((x) =>
                x.id === a.id ? { ...x, completed: !x.completed } : x,
              ),
            })
          }
        >
          {a.completed && <Check size={13} />}
        </button>
      </div>
    );
  }
  function weightChart() {
    return (
      <Suspense fallback={<div className="chart muted">Loading chart…</div>}>
        <WeightChart weights={weights} />
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
  function saveForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = (k: string) => String(f.get(k) || "");
    const number = (k: string) => Number(f.get(k));
    if (modal === "task") {
      const t: Task = {
        id: editTask?.id || uid(),
        name: value("name").trim(),
        category: value("category"),
        priority: value("priority") as Task["priority"],
        due: value("due"),
        completed: editTask?.completed || false,
        recurring: f.get("recurring") === "on",
      };
      if (!t.name) return;
      update({
        ...data,
        tasks: editTask
          ? data.tasks.map((x) => (x.id === t.id ? t : x))
          : [...data.tasks, t],
      });
    }
    if (modal === "course") {
      const c = {
        id: selectedCourse?.id || uid(),
        name: value("name").trim(),
        code: value("code").trim(),
        instructor: value("instructor"),
        grade: number("grade"),
        notes: value("notes"),
      };
      if (!c.name) return;
      update({
        ...data,
        courses: selectedCourse
          ? data.courses.map((x) => (x.id === c.id ? c : x))
          : [...data.courses, c],
      });
    }
    if (modal === "assignment") {
      const a: Assignment = {
        id: editAssignment?.id || uid(),
        name: value("name").trim(),
        courseId: value("courseId"),
        due: value("due"),
        type: value("type") as Assignment["type"],
        completed: editAssignment?.completed || false,
      };
      if (!a.name) return;
      update({
        ...data,
        assignments: editAssignment
          ? data.assignments.map((x) => (x.id === a.id ? a : x))
          : [...data.assignments, a],
      });
    }
    if (modal === "weight") {
      const entry = { date: value("date"), value: number("weight") };
      update({
        ...data,
        weights: [...data.weights.filter((w) => w.date !== entry.date), entry],
        goalWeight: number("goal"),
      });
    }
    if (modal === "workout") {
      update({
        ...data,
        workouts: [
          ...data.workouts,
          {
            id: uid(),
            date: value("date"),
            name: value("name").trim(),
            exercise: value("exercise").trim(),
            weight: number("weight"),
            reps: number("reps"),
            completed: true,
          },
        ],
      });
    }
    if (modal === "nutrition") {
      const entry = {
        date: day(),
        calories: number("calories"),
        protein: number("protein"),
        steps: number("steps"),
      };
      update({
        ...data,
        nutrition: [...data.nutrition.filter((n) => n.date !== day()), entry],
      });
    }
    setModal(null);
    setEditTask(null);
    setEditAssignment(null);
  }
  const addTask = () => {
    setEditTask(null);
    setModal("task");
  };
  const addAssignment = () => {
    setEditAssignment(null);
    setModal("assignment");
  };
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
              className={`nav-item ${page === n.name ? "active" : ""}`}
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
              localStorage.setItem("dylan-theme", next);
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
              aria-label="Add task"
              onClick={addTask}
            >
              <Plus size={19} />
            </button>
            <div className="avatar small">D</div>
          </div>
        </header>
        <div className="content">
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
                <button className="primary" onClick={addTask}>
                  <Plus size={17} /> Quick add
                </button>
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
                      data.tasks.filter((t) => t.due === day() && t.completed)
                        .length
                    }{" "}
                    completed today
                  </p>
                </div>
                <div className="stat">
                  <span>
                    <GraduationCap size={16} /> College deadlines
                  </span>
                  <strong>
                    {deadlines.filter((a) => a.due <= day(7)).length}
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
                    {weight}
                    <small>lb</small>
                  </strong>
                  <p className="green">
                    <ArrowDownRight size={13} />
                    {(avg - previousAvg).toFixed(1)} lb vs. last week’s average
                  </p>
                </div>
                <div className="stat">
                  <span>
                    <Flame size={16} /> Daily habits
                  </span>
                  <strong>
                    {habitsDone}
                    <small>/ {data.habits.length}</small>
                  </strong>
                  <p>Your small wins add up</p>
                </div>
              </div>
              <div className="today-grid">
                <div className="column">
                  <Card
                    title="Top priorities"
                    subtitle="Put your energy where it matters."
                    action={<span className="pill">FOCUS</span>}
                  >
                    <div className="priorities">
                      {priorities.slice(0, 3).map((t, i) => (
                        <div className="priority-row" key={t.id}>
                          <span className="priority-number">0{i + 1}</span>
                          <div>
                            <strong>{t.name}</strong>
                            <p>{t.category}</p>
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
                          No urgent priorities. Pick something meaningful.
                        </Empty>
                      )}
                    </div>
                  </Card>
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
                    title="College, coming up"
                    action={
                      <button
                        className="subtle-link"
                        onClick={() => navigate("College")}
                      >
                        View all <ArrowUpRight size={14} />
                      </button>
                    }
                  >
                    {deadlines.slice(0, 3).map(assignmentRow)}
                    {!deadlines.length && (
                      <Empty>No pending assignments.</Empty>
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
                          {w.exercise} · {w.weight} lb × {w.reps} reps
                        </p>
                        <button
                          className={w.completed ? "secondary" : "primary"}
                          onClick={() =>
                            update({
                              ...data,
                              workouts: data.workouts.map((x) =>
                                x.id === w.id
                                  ? { ...x, completed: !x.completed }
                                  : x,
                              ),
                            })
                          }
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
                  >
                    {data.habits.map((h, i) => (
                      <div className="habit-row" key={h.name}>
                        <button
                          className={`checkbox ${h.dates.includes(day()) ? "checked" : ""}`}
                          aria-label={`Toggle ${h.name}`}
                          onClick={() =>
                            update({
                              ...data,
                              habits: data.habits.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      dates: x.dates.includes(day())
                                        ? x.dates.filter((d) => d !== day())
                                        : [...x.dates, day()],
                                    }
                                  : x,
                              ),
                            })
                          }
                        >
                          {h.dates.includes(day()) && <Check size={13} />}
                        </button>
                        <span>{h.name}</span>
                      </div>
                    ))}
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${(habitsDone / data.habits.length) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="progress-caption">
                      {habitsDone} of {data.habits.length} habits complete{" "}
                      <span>
                        {Math.round((habitsDone / data.habits.length) * 100)}%
                      </span>
                    </div>
                  </Card>
                  <Card
                    title="Weight trend"
                    action={<span className="pill">28 DAYS</span>}
                  >
                    <div className="mini-stat">
                      <strong>
                        {avg.toFixed(1)} <small>lb</small>
                      </strong>
                      <span>7-day average</span>
                    </div>
                    {weightChart()}
                  </Card>
                  <Card
                    title="On the horizon"
                    action={<CalendarDays size={17} className="muted" />}
                  >
                    {data.dates
                      .filter((d) => d.date >= day())
                      .map((d) => (
                        <div className="important-date" key={d.name}>
                          <span>{d.name}</span>
                          <strong>{formatDate(d.date)}</strong>
                        </div>
                      ))}
                  </Card>
                </div>
              </div>
            </>
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
                            {c.grade}% <small>grade</small>
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
                          disabled={!data.courses.length}
                          onClick={addAssignment}
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
                      <button className="subtle-link" onClick={addAssignment}>
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
                        {selectedCourse.grade}
                        <small>%</small>
                      </div>
                      <p className="muted">
                        Manually recorded course grade. Edit the course to
                        update.
                      </p>
                    </Card>
                    <Card title="Course notes">
                      <textarea
                        className="notes"
                        aria-label="Course notes"
                        value={selectedCourse.notes}
                        onChange={(e) =>
                          update({
                            ...data,
                            courses: data.courses.map((c) =>
                              c.id === courseId
                                ? { ...c, notes: e.target.value }
                                : c,
                            ),
                          })
                        }
                      />
                      <p className="row-meta">
                        Saved automatically on this device.
                      </p>
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
              <div className="stat-grid">
                <div className="stat">
                  <span>Body weight</span>
                  <strong>
                    {weight}
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
                    {avg.toFixed(1)}
                    <small>lb</small>
                  </strong>
                  <p>{(avg - previousAvg).toFixed(1)} lb from prior 7 days</p>
                </div>
                <div className="stat">
                  <span>Goal weight</span>
                  <strong>
                    {data.goalWeight}
                    <small>lb</small>
                  </strong>
                  <p>
                    {Math.abs(weight - data.goalWeight).toFixed(1)} lb from goal
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
                              {w.weight} lb × {w.reps}
                            </td>
                            <td>
                              <button
                                className="pill"
                                onClick={() =>
                                  update({
                                    ...data,
                                    workouts: data.workouts.map((x) =>
                                      x.id === w.id
                                        ? { ...x, completed: !x.completed }
                                        : x,
                                    ),
                                  })
                                }
                              >
                                {w.completed ? "Completed" : "Planned"}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
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
                {["All", "Today", "Upcoming", "Completed"].map((f) => (
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
                              : f === "Upcoming"
                                ? t.due > day() && !t.completed
                                : t.completed,
                        ).length
                      }
                    </span>
                  </button>
                ))}
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
            <span>V1 foundation · Sample data · Stored on this device</span>
          </footer>
        </div>
      </main>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
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
                {modal === "task"
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
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveForm}>
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
                        {["Personal", "College", "Fitness", "Work"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
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
                        required
                        defaultValue={selectedCourse?.grade || 0}
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
                        defaultValue={editAssignment?.type || "Assignment"}
                      >
                        <option>Assignment</option>
                        <option>Exam</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
              {modal === "weight" && (
                <>
                  <label>
                    Date
                    <input
                      name="date"
                      type="date"
                      max={day()}
                      required
                      defaultValue={day()}
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
                        defaultValue={weight}
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
                        required
                        defaultValue={data.goalWeight}
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
                    />
                  </label>
                  <label>
                    Date
                    <input
                      name="date"
                      type="date"
                      max={day()}
                      required
                      defaultValue={day()}
                    />
                  </label>
                  <label>
                    Exercise
                    <input name="exercise" required placeholder="Bench press" />
                  </label>
                  <div className="form-grid">
                    <label>
                      Weight (lb)
                      <input
                        name="weight"
                        type="number"
                        min="0"
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
                        max="1000"
                        required
                      />
                    </label>
                  </div>
                  <p className="row-meta">
                    Logs one completed working set. Add more entries for
                    additional sets.
                  </p>
                </>
              )}
              {modal === "nutrition" && (
                <>
                  <label>
                    Calories (kcal)
                    <input
                      name="calories"
                      type="number"
                      min="0"
                      max="20000"
                      required
                      defaultValue={nutrition.calories}
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
                      defaultValue={nutrition.protein}
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
                      defaultValue={nutrition.steps}
                    />
                  </label>
                </>
              )}
              <div className="form-actions">
                {editTask && modal === "task" && (
                  <button
                    type="button"
                    className="danger text-button"
                    onClick={() => {
                      update({
                        ...data,
                        tasks: data.tasks.filter((t) => t.id !== editTask.id),
                      });
                      setModal(null);
                      setEditTask(null);
                    }}
                  >
                    Delete task
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Save {modal === "nutrition" ? "totals" : modal}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
