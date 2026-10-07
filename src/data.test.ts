import { describe, it, expect } from "vitest";
import {
  sampleData,
  day,
  toggleTask,
  averageWeight,
  localAssistant,
  sessionCount,
} from "./data";
describe("connected workspace", () => {
  it("counts a workout with multiple sets as one session", () => {
    const workout = sampleData().workouts[0];
    expect(
      sessionCount([
        workout,
        { ...workout, id: "another-set" },
        { ...workout, id: "planned", completed: false },
      ]),
    ).toBe(1);
  });
  it("completes daily recurring tasks and creates exactly one next-day task", () => {
    let s = sampleData();
    s = toggleTask(s, "t3");
    expect(s.tasks.find((t) => t.id === "t3")?.completed).toBe(true);
    expect(
      s.tasks.filter((t) => t.name === "Read 20 pages" && t.due === day(1)),
    ).toHaveLength(1);
    s = toggleTask(toggleTask(s, "t3"), "t3");
    expect(
      s.tasks.filter((t) => t.name === "Read 20 pages" && t.due === day(1)),
    ).toHaveLength(1);
  });
  it("calculates seven calendar days, excluding future and older entries", () => {
    expect(
      averageWeight([
        { date: day(-7), value: 900 },
        { date: day(-6), value: 180 },
        { date: day(), value: 182 },
        { date: day(1), value: 900 },
      ]),
    ).toBe(181);
  });
  it("assistant reads newly added assignments without mutating data", async () => {
    const s = sampleData();
    s.assignments.push({
      id: "new",
      courseId: "c1",
      name: "New real assignment",
      due: day(1),
      type: "Assignment",
      completed: false,
    });
    const before = JSON.stringify(s);
    expect(
      await localAssistant.reply("What assignments are coming up?", s),
    ).toContain("New real assignment");
    expect(JSON.stringify(s)).toBe(before);
  });
  it("priorities exclude completed tasks", async () => {
    let s = sampleData();
    s = toggleTask(s, "t1");
    expect(
      await localAssistant.reply("What should I prioritize today?", s),
    ).not.toContain("Finish the research outline");
  });
});
