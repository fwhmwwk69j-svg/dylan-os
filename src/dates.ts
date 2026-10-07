export function day(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDate(d);
}
export function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
