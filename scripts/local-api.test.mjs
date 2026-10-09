import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import pg from "pg";
import {
  operationId,
  envelope,
  mutation,
  syntheticTask,
} from "./operation-fixtures.mjs";
const base = "http://127.0.0.1:55433";
const admin = new pg.Client({
  connectionString:
    "postgresql://postgres:synthetic-test-only@127.0.0.1:55432/postgres",
});
const A = "44444444-4444-4444-8444-444444444444",
  B = "55555555-5555-4555-8555-555555555555",
  SA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  SB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
function jwt(sub, session_id, expiry = Math.floor(Date.now() / 1000) + 600) {
  const part = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body =
    part({ alg: "HS256", typ: "JWT" }) +
    "." +
    part({
      sub,
      session_id,
      role: "authenticated",
      exp: expiry,
    });
  return (
    body +
    "." +
    createHmac(
      "sha256",
      "dylan-local-synthetic-jwt-secret-not-for-hosted-staging",
    )
      .update(body)
      .digest("base64url")
  );
}
const TA = jwt(A, SA),
  TB = jwt(B, SB);
async function request(path, token, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
const rpc = (name, token, body = {}) =>
  request("/rpc/" + name, token, "POST", body);
const task = (id) => ({
  id,
  name: id,
  category: "Personal",
  priority: "High",
  due: "2026-10-08",
  completed: false,
  recurring: false,
});
const read = async (token) => {
  const r = await rpc("dylan_read", token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers.get("cache-control"), "no-store");
  return r.body;
};
before(async () => {
  await admin.connect();
  await admin.query("delete from auth.sessions where user_id=any($1::uuid[])", [
    [A, B],
  ]);
  await admin.query("delete from auth.users where id=any($1::uuid[])", [
    [A, B],
  ]);
  await admin.query("insert into auth.users(id) values($1),($2)", [A, B]);
  await admin.query(
    "insert into auth.sessions(id,user_id) values($1,$2),($3,$4)",
    [SA, A, SB, B],
  );
  await admin.query(
    "insert into public.dylan_staging_accounts(user_id,enabled) values($1,true),($2,true)",
    [A, B],
  );
  for (let i = 0; i < 20; i++) {
    try {
      const r = await request("/tasks", TA);
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("PostgREST not ready");
});
after(async () => {
  await admin.query("delete from auth.sessions where user_id=any($1::uuid[])", [
    [A, B],
  ]);
  await admin.query("delete from auth.users where id=any($1::uuid[])", [
    [A, B],
  ]);
  await admin.end();
});
test("real API rejects unsigned/tampered/anonymous requests", async () => {
  assert([401, 403].includes((await rpc("dylan_read")).status));
  assert.equal((await rpc("dylan_read", TA + "bad")).status, 401);
  assert.equal(
    (await rpc("dylan_read", jwt(A, SA, Math.floor(Date.now() / 1000) - 60)))
      .status,
    401,
  );
});
test("real JWT-authenticated API creates A record and RLS hides it from B", async () => {
  const r = await rpc("dylan_command", TA, {
    command: {
      action: "upsert",
      collection: "tasks",
      record: task("api-a"),
      expectedRevision: 0,
      expectedRecordRevision: 0,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await request("/tasks?id=eq.api-a", TB)).body.length, 0);
  assert.deepEqual((await read(TA)).data.tasks, [task("api-a")]);
  assert.deepEqual((await rpc("dylan_export", TB)).body.tasks, []);
});
test("API direct writes and client ownership spoofing are forbidden", async () => {
  assert(
    [401, 403].includes(
      (await request("/tasks", TB, "POST", { user_id: A, ...task("attack") }))
        .status,
    ),
  );
  assert(
    [401, 403].includes(
      (await request("/tasks?id=eq.api-a", TB, "PATCH", { name: "attack" }))
        .status,
    ),
  );
  const r = await rpc("dylan_command", TB, {
    command: {
      action: "upsert",
      collection: "tasks",
      record: task("attack"),
      expectedRevision: 0,
      expectedRecordRevision: 0,
      user_id: A,
    },
  });
  assert.equal(r.status, 400);
});
test("API cross-account course FK and snapshot restore fail atomically", async () => {
  let rev = (await read(TA)).revision;
  assert.equal(
    (
      await rpc("dylan_command", TA, {
        command: {
          action: "upsert",
          collection: "courses",
          record: {
            id: "api-course",
            name: "Course",
            code: "101",
            instructor: "Synthetic",
            grade: null,
            notes: "",
          },
          expectedRevision: rev,
          expectedRecordRevision: 0,
        },
      })
    ).status,
    200,
  );
  const bad = await rpc("dylan_command", TB, {
    command: {
      action: "upsert",
      collection: "assignments",
      record: {
        id: "bad",
        courseId: "api-course",
        name: "Exam",
        due: "2026-10-08",
        type: "Exam",
        completed: false,
      },
      expectedRevision: 0,
      expectedRecordRevision: 0,
    },
  });
  assert.equal(bad.status, 409);
  const snapshots = (await request("/workspace_snapshots?select=id", TA)).body;
  assert.equal(
    (await request("/workspace_snapshots?id=eq." + snapshots[0].id, TB)).body
      .length,
    0,
  );
  const restore = await rpc("dylan_command", TB, {
    command: {
      action: "restore",
      snapshotId: snapshots[0].id,
      expectedRevision: 0,
      confirmation: "RESTORE MY STAGING SNAPSHOT",
    },
  });
  assert.equal(restore.status, 403);
  assert.equal((await read(TB)).revision, 0);
});
test("two API commands racing one revision have exactly one success", async () => {
  const rev = (await read(TA)).revision;
  const results = await Promise.all(
    ["race1", "race2"].map((id) =>
      rpc("dylan_command", TA, {
        command: {
          action: "upsert",
          collection: "tasks",
          record: task(id),
          expectedRevision: rev,
          expectedRecordRevision: 0,
        },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
test("account switching on real API returns only the new account data", async () => {
  const a = await read(TA);
  assert(a.data.tasks.length > 0);
  const b = await read(TB);
  assert.deepEqual(b.data.tasks, []);
  assert.equal(b.revision, 0);
  assert.deepEqual((await rpc("dylan_export", TB)).body.courses, []);
});
test("API rejects still-signed JWT after session revocation", async () => {
  await admin.query("delete from auth.sessions where id=$1", [SB]);
  assert.equal((await rpc("dylan_read", TB)).status, 403);
});

const execute = (token, request) =>
  rpc("dylan_execute_operation", token, { request });
const status = (token, id) =>
  rpc("dylan_operation_status", token, { operation_id: id });
test("operation API authenticates callers and keeps receipts inaccessible across accounts", async () => {
  // Restore only the synthetic fixture session revoked by the preceding legacy test.
  await admin.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    SB,
    B,
  ]);
  const current = await read(TA),
    req = envelope(
      current.revision,
      mutation("tasks", syntheticTask("api-operation")),
    );
  assert.equal((await execute(undefined, req)).status, 401);
  const created = await execute(TA, req);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.equal(created.body.workspace.revision, current.revision + 1);
  assert.equal((await status(TA, req.operationId)).body.status, "committed");
  assert.equal((await status(TB, req.operationId)).body.status, "not-found");
  for (const table of [
    "workspace_operation_receipts",
    "workspace_deletion_receipts",
  ]) {
    assert.equal((await requestHTTP(table)).status, 403);
  }
  async function requestHTTP(table) {
    return request("/" + table, TA);
  }
});
test("operation API retries safely, rejects payload reuse and invalid UUID admission", async () => {
  const current = await read(TA),
    req = envelope(
      current.revision,
      mutation("tasks", syntheticTask("api-retry")),
    );
  const first = await execute(TA, req),
    replay = await execute(TA, req);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(first.body.receipt, replay.body.receipt);
  assert.equal((await read(TA)).revision, current.revision + 1);
  assert.equal(
    (
      await execute(TA, {
        ...req,
        operation: { ...req.operation, record: syntheticTask("api-reuse") },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await execute(
        TA,
        envelope(
          (await read(TA)).revision,
          mutation("tasks", syntheticTask("api-expired")),
          operationId(Date.now() - 25 * 3600000),
        ),
      )
    ).status,
    400,
  );
});
test("operation API batches and ordering are atomic; bad final FK rolls back snapshots and receipts", async () => {
  const current = await read(TA),
    snapshots = (await request("/workspace_snapshots?order=id", TA)).body;
  const bad = envelope(current.revision, {
    action: "batch",
    mutations: [
      mutation("tasks", syntheticTask("api-first")),
      mutation("assignments", {
        id: "api-final",
        name: "Synthetic",
        courseId: "missing",
        due: "2026-10-09",
        type: "Exam",
        completed: false,
      }),
    ],
  });
  assert.equal((await execute(TA, bad)).status, 409);
  assert.deepEqual(await read(TA), current);
  assert.deepEqual(
    (await request("/workspace_snapshots?order=id", TA)).body,
    snapshots,
  );
  assert.equal((await status(TA, bad.operationId)).body.status, "not-found");
  const result = await execute(
    TA,
    envelope(current.revision, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("api-batch-z")),
        mutation("tasks", syntheticTask("api-batch-a")),
      ],
    }),
  );
  assert.equal(result.status, 200);
  const ids = result.body.workspace.data.tasks.map((r) => r.id).reverse();
  const reordered = await execute(
    TA,
    envelope(result.body.workspace.revision, {
      action: "reorder",
      collection: "tasks",
      ids,
    }),
  );
  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.workspace.data.tasks.map((r) => r.id),
    ids,
  );
});
test("operation API concurrent retries commit once and competing workspace edits conflict", async () => {
  const revision = (await read(TA)).revision,
    req = envelope(
      revision,
      mutation("tasks", syntheticTask("api-concurrent-retry")),
    );
  const retries = await Promise.all([execute(TA, req), execute(TA, req)]);
  assert.deepEqual(
    retries.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(retries.map((r) => r.body.replayed).sort(), [false, true]);
  const next = (await read(TA)).revision;
  const race = await Promise.all([
    execute(
      TA,
      envelope(next, mutation("tasks", syntheticTask("api-concurrent-a"))),
    ),
    execute(
      TA,
      envelope(next, mutation("tasks", syntheticTask("api-concurrent-b"))),
    ),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await read(TA)).revision, next + 1);
});
test("operation API course deletion and scoped Undo preserve linked records and reject foreign Undo", async () => {
  let current = await read(TA);
  const course = {
    id: "api-course-undo",
    name: "Synthetic",
    code: "SYN",
    instructor: "Synthetic",
    grade: null,
    notes: "",
    extra: { keep: true },
  };
  const assignment = {
    id: "api-exam-undo",
    name: "Synthetic exam",
    courseId: course.id,
    due: "2026-10-09",
    type: "Exam",
    completed: false,
  };
  const added = await execute(
    TA,
    envelope(current.revision, {
      action: "batch",
      mutations: [
        mutation("assignments", assignment),
        mutation("courses", course),
      ],
    }),
  );
  assert.equal(added.status, 200);
  current = added.body.workspace;
  const deletion = await execute(
    TA,
    envelope(current.revision, {
      action: "delete",
      collection: "courses",
      id: course.id,
      expectedRecordRevision: current.recordRevisions.courses[course.id],
      expectedLinkedRevisions: {
        [assignment.id]: current.recordRevisions.assignments[assignment.id],
      },
    }),
  );
  assert.equal(deletion.status, 200);
  const id = deletion.body.receipt.deletionId;
  assert.equal(
    (
      await execute(
        TB,
        envelope((await read(TB)).revision, { action: "undo", deletionId: id }),
      )
    ).status,
    403,
  );
  const undoReq = envelope(deletion.body.workspace.revision, {
    action: "undo",
    deletionId: id,
  });
  const undo = await execute(TA, undoReq);
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.deepEqual(
    undo.body.workspace.data.courses.find((r) => r.id === course.id),
    course,
  );
  assert.deepEqual(
    undo.body.workspace.data.assignments.find((r) => r.id === assignment.id),
    assignment,
  );
  assert.equal((await execute(TA, undoReq)).body.replayed, true);
  assert.equal(
    (
      await execute(
        TA,
        envelope(undo.body.workspace.revision, {
          action: "undo",
          deletionId: id,
        }),
      )
    ).status,
    409,
  );
});
test("operation API denies expired JWT and revoked live sessions including cached replays", async () => {
  const req = envelope(
    (await read(TA)).revision,
    mutation("tasks", syntheticTask("api-auth-replay")),
  );
  assert.equal((await execute(TA, req)).status, 200);
  const expired = jwt(A, SA, Math.floor(Date.now() / 1000) - 60);
  assert.equal((await execute(expired, req)).status, 401);
  try {
    await admin.query(
      "update auth.sessions set not_after=now()-interval '1 minute' where id=$1",
      [SA],
    );
    assert.equal((await execute(TA, req)).status, 403);
    assert.equal((await status(TA, req.operationId)).status, 403);
  } finally {
    await admin.query("update auth.sessions set not_after=null where id=$1", [
      SA,
    ]);
  }
  assert.equal((await execute(TA, req)).body.replayed, true);
});
test("operation API stale record/workspace conflicts do not consume operation IDs", async () => {
  const current = await read(TA),
    record = current.data.tasks[0];
  const requests = [
    envelope(
      current.revision - 1,
      mutation("tasks", syntheticTask("api-stale-workspace")),
    ),
    envelope(
      current.revision,
      mutation("tasks", record, current.recordRevisions.tasks[record.id] + 1),
    ),
  ];
  for (const req of requests) {
    assert.equal((await execute(TA, req)).status, 409);
    assert.deepEqual(await read(TA), current);
    assert.equal((await status(TA, req.operationId)).body.status, "not-found");
  }
});
