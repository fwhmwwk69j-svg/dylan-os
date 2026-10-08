export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Calendar dates are not UTC instants. Arithmetic never adds 24 elapsed hours. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(value + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function addCalendarDays(date: string, offset: number) {
  if (!isCalendarDate(date) || !Number.isInteger(offset))
    throw new Error("Invalid calendar date or day offset.");
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function weekday(date: string) {
  if (!isCalendarDate(date)) throw new Error("Invalid calendar date.");
  return new Date(date + "T12:00:00Z").getUTCDay();
}
export function todayInZone(timeZone: string, clock: Clock = systemClock) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(clock.now());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function day(offset = 0) {
  return addCalendarDays(localDate(systemClock.now()), offset);
}
