import { LEGACY_ID_COLLECTIONS } from "./collections";
/** Non-secret deterministic identity, not an authorization token or cryptographic digest. */
function digest(input: string) {
  const lanes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < input.length; i++)
    for (let n = 0; n < lanes.length; n++)
      lanes[n] = Math.imul(
        lanes[n] ^ input.charCodeAt(i) ^ (n * 97),
        0x01000193,
      );
  return lanes.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}
export function addLegacyIds(root: Record<string, unknown>) {
  const next = { ...root };
  for (const collection of LEGACY_ID_COLLECTIONS) {
    const records = root[collection] as Record<string, unknown>[];
    const used = new Set(
      records.filter((r) => r.id !== undefined).map((r) => r.id),
    );
    next[collection] = records.map((record) => {
      if (record.id !== undefined) return record;
      const identity =
        collection === "habits"
          ? record.name
          : collection === "dates"
            ? [record.name, record.date]
            : record.date;
      const base = `legacy-${collection}-${digest(JSON.stringify(identity))}`;
      let id = base,
        suffix = 0;
      while (used.has(id)) id = `${base}-${++suffix}`;
      used.add(id);
      return { ...record, id };
    });
  }
  return next;
}
