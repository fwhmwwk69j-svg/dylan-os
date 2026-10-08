import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import pg from "pg";
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
