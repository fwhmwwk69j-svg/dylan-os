import type { State } from "../data";
import { weekday, isCalendarDate } from "../dates";
export type CalendarDate = string;
export type ZonedInterval = {
  startsAt: string;
  endsAt: string;
  timeZone: string;
};
export function assertTimeZone(zone: string) {
  new Intl.DateTimeFormat("en-US", { timeZone: zone });
}
export function recurringOn(
  series: {
    days: number[];
    startsOn: string;
    endsOn: string | null;
    exceptions: string[];
  },
  date: CalendarDate,
) {
  if (!isCalendarDate(date)) throw new Error("Invalid occurrence date.");
  return (
    series.startsOn <= date &&
    (!series.endsOn || series.endsOn >= date) &&
    series.days.includes(weekday(date)) &&
    !series.exceptions.includes(date)
  );
}
export function occurrenceKey(id: string, date: CalendarDate) {
  if (!id || !isCalendarDate(date))
    throw new Error("Invalid occurrence identity.");
  return JSON.stringify([id, date]);
}
export function overlaps(a: ZonedInterval, b: ZonedInterval) {
  for (const interval of [a, b]) {
    assertTimeZone(interval.timeZone);
    if (
      !/(Z|[+-]\d{2}:\d{2})$/.test(interval.startsAt) ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(interval.endsAt) ||
      !Number.isFinite(Date.parse(interval.startsAt)) ||
      !Number.isFinite(Date.parse(interval.endsAt)) ||
      Date.parse(interval.endsAt) <= Date.parse(interval.startsAt)
    )
      throw new Error(
        "Intervals require offset timestamps and a positive duration.",
      );
  }
  return (
    Date.parse(a.startsAt) < Date.parse(b.endsAt) &&
    Date.parse(b.startsAt) < Date.parse(a.endsAt)
  );
}
/** Existing commitments remain floating local wall times; no historical UTC conversion. */
export function scheduleContract(state: State) {
  return {
    mode: "floating-local" as const,
    dateOnly: true as const,
    fixedSeries: state.commitments,
    flexibleTasks: state.tasks,
  };
}
