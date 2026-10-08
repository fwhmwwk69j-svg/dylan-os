import { useState } from "react";
import type { State } from "./data";
import { day, localDate } from "./dates";
import {
  habitCount,
  habitPlan,
  habitComplete,
  habitStreak,
  habitWeek,
  scheduled,
} from "./daily";
export default function HabitHistory({
  data,
  onEdit,
  onToday,
}: {
  data: State;
  onEdit: (index: number) => void;
  onToday: () => void;
}) {
  const [end, setEnd] = useState(day());
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONSISTENCY WITH ROOM TO REST</div>
          <h1>Habit history</h1>
          <p>Scheduled days count toward consistency. Rest days do not.</p>
        </div>
        <button className="secondary" onClick={onToday}>
          Back to Today
        </button>
      </div>
      <label className="history-date">
        History ending on{" "}
        <input
          type="date"
          value={end}
          max={day()}
          onChange={(e) => {
            if (e.target.value) setEnd(e.target.value);
          }}
        />
      </label>
      {data.habits.map((h, index) => {
        const week = habitWeek(h);
        return (
          <section className="card habit-history-card" key={index}>
            <div className="card-heading">
              <div>
                <h2>{h.name}</h2>
                <p>
                  {habitStreak(h)} scheduled-day streak · {week.complete}/
                  {week.possible} this week · {week.percent ?? "—"}%
                </p>
              </div>
              <button className="secondary" onClick={() => onEdit(index)}>
                Edit habit
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Progress</th>
                    <th>Target</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 28 }, (_, i) => {
                    const d = new Date(end + "T12:00:00");
                    d.setDate(d.getDate() - i);
                    const date = localDate(d);
                    return (
                      <tr key={date}>
                        <td>{date}</td>
                        <td>{habitCount(h, date)}</td>
                        <td>
                          {scheduled(h, date) ? habitPlan(h, date).target : "—"}
                        </td>
                        <td>
                          {h.createdOn && date < h.createdOn
                            ? "Not started"
                            : !scheduled(h, date)
                              ? "Rest day"
                              : habitComplete(h, date)
                                ? "Complete"
                                : date === day()
                                  ? "In progress"
                                  : "Missed"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!data.habits.length && (
        <p className="empty">Add your first habit from Today.</p>
      )}
    </>
  );
}
