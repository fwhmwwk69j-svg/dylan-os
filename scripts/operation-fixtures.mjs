import { randomBytes } from "node:crypto";
/** Synthetic RFC 9562 UUIDv7 with an injectable clock for expiry tests. */
export function operationId(at = Date.now()) {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(at, 0, 6);
  bytes[6] = (bytes[6] & 15) | 0x70;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const envelope = (revision, operation, id = operationId()) => ({
  version: 1,
  operationId: id,
  expectedRevision: revision,
  operation,
});
export const mutation = (collection, record, expectedRecordRevision = 0) => ({
  action: "upsert",
  collection,
  record,
  expectedRecordRevision,
});
export const syntheticTask = (id) => ({
  id,
  name: id,
  category: "Personal",
  priority: "High",
  due: "2026-10-09",
  completed: false,
  recurring: false,
  extra: { nested: [null, true] },
});
export function domainRecords(prefix) {
  return [
    [
      "courses",
      {
        id: prefix + "-course",
        name: "Synthetic",
        code: "SYN",
        instructor: "Synthetic",
        grade: null,
        notes: "",
        future: { keep: true },
      },
    ],
    ["tasks", syntheticTask(prefix + "-task")],
    [
      "assignments",
      {
        id: prefix + "-exam",
        name: "Synthetic exam",
        courseId: prefix + "-course",
        due: "2026-10-09",
        type: "Exam",
        completed: false,
        grade: null,
      },
    ],
    ["weights", { id: prefix + "-weight", date: "2025-01-01", value: 160 }],
    [
      "nutrition",
      {
        id: prefix + "-nutrition",
        date: "2025-01-01",
        calories: 2000,
        protein: 100,
        steps: 8000,
      },
    ],
    [
      "workouts",
      {
        id: prefix + "-workout",
        date: "2025-01-01",
        name: "Synthetic",
        exercise: "Bench",
        weight: 100,
        reps: 5,
        completed: false,
      },
    ],
    [
      "habits",
      {
        id: prefix + "-habit",
        name: "Synthetic",
        dates: ["2025-01-01"],
        counts: { "2025-01-01": 1 },
        scheduleHistory: [
          { effectiveOn: "2025-01-01", days: [1], target: 1, future: true },
        ],
      },
    ],
    ["dates", { id: prefix + "-date", date: "2025-01-01", name: "Synthetic" }],
    [
      "commitments",
      {
        id: prefix + "-commitment",
        name: prefix,
        kind: "Class",
        days: [1, 3],
        startTime: "09:00",
        endTime: "10:00",
        startsOn: "2025-01-01",
        endsOn: null,
        exceptions: [],
      },
    ],
    [
      "weeklyReflections",
      {
        id: prefix + "-reflection",
        weekStart: "2025-01-06",
        reflection: "Synthetic",
        priorities: ["a", "b", "c"],
        savedAt: "2025-01-06T12:00:00Z",
      },
    ],
  ];
}
