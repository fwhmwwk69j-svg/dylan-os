import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
const url = process.env.DYLAN_DB_URL;
if (!url || process.env.DYLAN_DISPOSABLE_DB !== "1")
  throw Error(
    "Requires DYLAN_DB_URL and explicit DYLAN_DISPOSABLE_DB=1. This runner resets an isolated synthetic database.",
  );
if (
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  new URL(url).port !== "55432"
)
  throw Error(
    "Disposable tests only permit local port 55432; use the separate hosted runner for staging.",
  );
const admin = new pg.Client({ connectionString: url });
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333";
const SA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  SB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  SC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let a, b, anonymous;
async function user(who, session, role = "authenticated") {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`set role ${role}`);
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: who, session_id: session, role }),
  ]);
  return client;
}
const call = async (client, name, value) =>
  (
    await client.query(
      `select public.${name}(${value === undefined ? "" : "$1::jsonb"}) as result`,
      value === undefined ? [] : [JSON.stringify(value)],
    )
  ).rows[0].result;
const command = (client, cmd) => call(client, "dylan_command", cmd);
const read = (client) => call(client, "dylan_read");
const task = (id) => ({
  id,
  name: id,
  category: "Personal",
  priority: "High",
  due: "2026-10-08",
  completed: false,
  recurring: false,
  extension: { keep: true },
});
const course = (id) => ({
  id,
  name: id,
  code: "101",
  instructor: "Synthetic",
  grade: null,
  notes: "Synthetic note",
});
const upsert = async (client, collection, record, recordRevision = 0) =>
  command(client, {
    action: "upsert",
    collection,
    record,
    expectedRevision: (await read(client)).revision,
    expectedRecordRevision: recordRevision,
  });
before(async () => {
  await admin.connect();
  await admin.query(
    "drop schema if exists storage cascade; drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists dylan_private cascade; drop role if exists authenticator; drop role if exists authenticated; drop role if exists anon; create schema public;",
  );
  await admin.query(await fs.readFile("supabase/tests/bootstrap.sql", "utf8"));
  for (const file of (await fs.readdir("supabase/migrations")).sort())
    await admin.query(await fs.readFile("supabase/migrations/" + file, "utf8"));
  await admin.query("insert into auth.users(id) values($1),($2),($3)", [
    A,
    B,
    C,
  ]);
  await admin.query(
    "insert into auth.sessions(id,user_id) values($1,$2),($3,$4),($5,$6)",
    [SA, A, SB, B, SC, C],
  );
  await admin.query(
    "insert into public.dylan_staging_accounts(user_id,enabled) values($1,true),($2,true)",
    [A, B],
  );
  a = await user(A, SA);
  b = await user(B, SB);
  anonymous = await user(null, null, "anon");
});
after(async () => {
  for (const c of [a, b, anonymous, admin]) if (c) await c.end();
});
test("anonymous RPC/read/write and unapproved accounts are denied", async () => {
  await assert.rejects(read(anonymous), /permission denied/);
  await assert.rejects(
    anonymous.query("select * from public.tasks"),
    /permission denied/,
  );
  await assert.rejects(
    command(anonymous, { action: "upsert" }),
    /permission denied/,
  );
  const unapproved = await user(C, SC);
  try {
    await assert.rejects(read(unapproved), /not authorized/);
  } finally {
    await unapproved.end();
  }
});
test("owned reads/exports preserve fields and account B sees none of A rows", async () => {
  await upsert(a, "tasks", task("a-task"));
  await upsert(b, "tasks", task("b-task"));
  assert.deepEqual((await read(a)).data.tasks, [task("a-task")]);
  assert.deepEqual((await read(b)).data.tasks, [task("b-task")]);
  assert.equal(
    (await b.query("select * from public.tasks where user_id=$1", [A]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await b.query(
        "select * from public.account_workspaces where user_id=$1",
        [A],
      )
    ).rowCount,
    0,
  );
  const exported = await call(b, "dylan_export");
  assert.deepEqual(exported.tasks, [task("b-task")]);
  assert.equal(exported.schemaVersion, 6);
  assert(exported.exportedAt);
});
test("direct owner/foreign-owner insert/update/delete are denied, not just filtered UI", async () => {
  for (const sql of [
    "insert into public.tasks(user_id,id,present_fields,name,category,priority,due,completed,recurring) values($1,'bad','{}','bad','Personal','High','2026-10-08',false,false)",
    "update public.tasks set name='hijack' where user_id=$1",
    "delete from public.tasks where user_id=$1",
  ]) {
    await assert.rejects(b.query(sql, [A]), /permission denied/);
  }
  await assert.rejects(
    a.query("update public.tasks set name='bypass' where user_id=$1", [A]),
    /permission denied/,
  );
  await assert.rejects(
    b.query("select dylan_private.export_state($1)", [A]),
    /permission denied/,
  );
});
test("owner and subscription claims in commands cannot grant authority", async () => {
  for (const key of [
    "user_id",
    "userId",
    "owner",
    "permissions",
    "entitlements",
  ])
    await assert.rejects(
      command(b, {
        action: "upsert",
        collection: "tasks",
        record: task("spoof"),
        expectedRevision: (await read(b)).revision,
        expectedRecordRevision: 0,
        [key]: A,
      }),
      /authority/,
    );
  await upsert(b, "tasks", {
    ...task("inert-fields"),
    user_id: A,
    permissions: ["admin"],
  });
  assert.equal(
    (await a.query("select * from public.tasks where id=$1", ["inert-fields"]))
      .rowCount,
    0,
  );
  assert.deepEqual(
    (await read(b)).data.tasks.find((t) => t.id === "inert-fields").permissions,
    ["admin"],
  );
});
test("composite ownership FK rejects A course references from B commands and privileged SQL", async () => {
  await upsert(a, "courses", course("only-a"));
  const before = await read(b),
    beforeSnapshots = (
      await b.query("select id from public.workspace_snapshots")
    ).rowCount;
  await assert.rejects(
    upsert(b, "assignments", {
      id: "bad-ref",
      name: "Synthetic exam",
      courseId: "only-a",
      due: "2026-10-09",
      type: "Exam",
      completed: false,
    }),
    /foreign key/,
  );
  assert.deepEqual(await read(b), before);
  assert.equal(
    (await b.query("select id from public.workspace_snapshots")).rowCount,
    beforeSnapshots,
  );
  await assert.rejects(
    admin.query(
      `insert into public.school_work(user_id,id,present_fields,name,"courseId",due,type,completed) values($1,'cross-owner','{}','x','only-a','2026-10-09','Exam',false)`,
      [B],
    ),
    /foreign key/,
  );
});
test("every current domain can be reconstructed through normalized tables", async () => {
  const rows = {
    assignments: {
      id: "exam",
      name: "Exam",
      courseId: "only-a",
      due: "2026-10-09",
      type: "Exam",
      completed: false,
      notes: "Keep",
      custom: "retain",
    },
    weights: { id: "weight", date: "2026-10-08", value: 180 },
    nutrition: {
      id: "nutrition",
      date: "2026-10-08",
      calories: 2200,
      protein: 150,
      steps: 8000,
    },
    workouts: {
      id: "workout",
      date: "2026-10-08",
      name: "Strength",
      exercise: "Bench",
      weight: 185,
      reps: 5,
      sets: 3,
      completed: true,
    },
    habits: {
      id: "habit",
      name: "Read",
      dates: ["2026-10-08"],
      target: 2,
      schedule: [1, 4],
      counts: { "2026-10-08": 2 },
      scheduleHistory: [
        { effectiveOn: "2026-10-01", days: [1, 4], target: 2, extra: "keep" },
      ],
    },
    dates: { id: "date", name: "Birthday", date: "2026-10-12" },
    commitments: {
      id: "series",
      name: "Class",
      kind: "Class",
      days: [1, 4],
      startTime: "09:00",
      endTime: "10:00",
      startsOn: "2026-10-01",
      endsOn: null,
      exceptions: ["2026-10-12"],
    },
    weeklyReflections: {
      id: "reflection",
      weekStart: "2026-10-05",
      reflection: "Synthetic",
      priorities: ["Study", "Train", "Rest"],
      savedAt: "2026-10-08T12:00:00.000Z",
    },
  };
  for (const [collection, record] of Object.entries(rows))
    await upsert(a, collection, record);
  const exported = await read(a);
  for (const [collection, record] of Object.entries(rows)) {
    const actual = exported.data[collection].find((r) => r.id === record.id);
    if (collection === "weeklyReflections")
      assert.equal(
        new Date(actual.savedAt).getTime(),
        new Date(record.savedAt).getTime(),
      );
    assert.deepEqual(
      {
        ...actual,
        ...(collection === "weeklyReflections"
          ? { savedAt: record.savedAt }
          : {}),
      },
      record,
    );
  }
});
test("workspace and record conflicts roll back rows and recovery snapshots", async () => {
  const before = await read(a),
    count = (await a.query("select id from public.workspace_snapshots"))
      .rowCount;
  await assert.rejects(
    command(a, {
      action: "upsert",
      collection: "tasks",
      record: task("a-task"),
      expectedRevision: before.revision - 1,
      expectedRecordRevision: before.recordRevisions.tasks["a-task"],
    }),
    /Workspace revision conflict/,
  );
  await assert.rejects(
    command(a, {
      action: "upsert",
      collection: "tasks",
      record: task("a-task"),
      expectedRevision: before.revision,
      expectedRecordRevision: 999,
    }),
    /Record revision conflict/,
  );
  assert.deepEqual(await read(a), before);
  assert.equal(
    (await a.query("select id from public.workspace_snapshots")).rowCount,
    count,
  );
});
test("simultaneous commands for the same revision allow exactly one winner", async () => {
  const second = await user(A, SA);
  try {
    const rev = (await read(a)).revision;
    const outcomes = await Promise.allSettled([
      command(a, {
        action: "upsert",
        collection: "tasks",
        record: task("race-a"),
        expectedRevision: rev,
        expectedRecordRevision: 0,
      }),
      command(second, {
        action: "upsert",
        collection: "tasks",
        record: task("race-b"),
        expectedRevision: rev,
        expectedRecordRevision: 0,
      }),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
    assert.equal((await read(a)).revision, rev + 1);
  } finally {
    await second.end();
  }
});
test("malformed records/duplicates/unknown commands roll back snapshots", async () => {
  const bad = [
    ["tasks", { ...task("invalid"), completed: "false" }],
    ["weights", { id: "invalid", date: "2026-02-30", value: 180 }],
    ["weights", { id: "duplicate-date", date: "2026-10-08", value: 190 }],
    [
      "habits",
      { id: "invalid", name: "Bad", dates: [], counts: { bad: "value" } },
    ],
    [
      "commitments",
      {
        id: "invalid",
        name: "Bad",
        kind: "Work",
        days: [1, 1],
        startTime: "10:00",
        endTime: "09:00",
        startsOn: "2026-10-01",
        endsOn: null,
        exceptions: [],
      },
    ],
  ];
  const before = await read(a),
    snapshots = await a.query(
      "select id from public.workspace_snapshots order by id",
    );
  for (const [collection, record] of bad)
    await assert.rejects(upsert(a, collection, record));
  await assert.rejects(
    command(a, { action: "import", expectedRevision: before.revision }),
    /Unsupported/,
  );
  assert.deepEqual(await read(a), before);
  assert.deepEqual(
    (await a.query("select id from public.workspace_snapshots order by id"))
      .rows,
    snapshots.rows,
  );
});
test("snapshot rotation retains five account-scoped snapshots and denies foreign restore", async () => {
  assert.equal(
    (await a.query("select id from public.workspace_snapshots")).rowCount,
    5,
  );
  const id = (
    await a.query("select id from public.workspace_snapshots limit 1")
  ).rows[0].id;
  assert.equal(
    (
      await b.query("select id from public.workspace_snapshots where id=$1", [
        id,
      ])
    ).rowCount,
    0,
  );
  const before = await read(b);
  await assert.rejects(
    command(b, {
      action: "restore",
      snapshotId: id,
      confirmation: "RESTORE MY STAGING SNAPSHOT",
      expectedRevision: before.revision,
    }),
    /unavailable/,
  );
  assert.deepEqual(await read(b), before);
  await assert.rejects(
    command(a, {
      action: "restore",
      snapshotId: id,
      confirmation: "yes",
      expectedRevision: (await read(a)).revision,
    }),
    /confirmation/,
  );
});
test("course cascade delete then confirmed restore preserves linked rows and advances revisions", async () => {
  const before = await read(a),
    id = "only-a";
  await command(a, {
    action: "delete",
    collection: "courses",
    id,
    expectedRevision: before.revision,
    expectedRecordRevision: before.recordRevisions.courses[id],
  });
  const deleted = await read(a);
  assert.equal(deleted.data.courses.length, 0);
  assert.equal(deleted.data.assignments.length, 0);
  const snap = (
    await a.query(
      "select id from public.workspace_snapshots where revision=$1",
      [before.revision],
    )
  ).rows[0].id;
  await command(a, {
    action: "restore",
    snapshotId: snap,
    confirmation: "RESTORE MY STAGING SNAPSHOT",
    expectedRevision: deleted.revision,
  });
  const restored = await read(a);
  assert.deepEqual(restored.data, before.data);
  assert.equal(restored.revision, deleted.revision + 1);
  assert(
    restored.recordRevisions.courses[id] > before.recordRevisions.courses[id],
  );
});
test("preferences and fitness goals remain private and recoverable", async () => {
  let current = await read(a);
  await command(a, {
    action: "preferences",
    preferences: {
      dashboard: { order: [], hidden: ["dates"] },
      custom: "keep",
    },
    expectedRevision: current.revision,
  });
  current = await read(a);
  await command(a, {
    action: "goals",
    goals: {
      goalWeight: 175,
      fitnessGoals: {
        calories: 2200,
        protein: 160,
        steps: 10000,
        weeklyWorkouts: 4,
        extra: "keep",
      },
    },
    expectedRevision: current.revision,
  });
  const state = (await read(a)).data;
  assert.equal(state.goalWeight, 175);
  assert.equal(state.fitnessGoals.extra, "keep");
  assert.equal(state.preferences.custom, "keep");
  assert.equal((await read(b)).data.goalWeight, null);
});
test("oldest retained snapshot can be restored even as a new snapshot rotates the history", async () => {
  const selected = (
    await a.query(
      "select id,payload from public.workspace_snapshots order by created_at,id limit 1",
    )
  ).rows[0];
  const before = await read(a);
  const restored = await command(a, {
    action: "restore",
    snapshotId: selected.id,
    confirmation: "RESTORE MY STAGING SNAPSHOT",
    expectedRevision: before.revision,
  });
  assert.deepEqual(restored.data, selected.payload);
  assert.equal(restored.revision, before.revision + 1);
  assert.equal(
    (await a.query("select id from public.workspace_snapshots")).rowCount,
    5,
  );
});
test("restrictive Storage policy denies quarantine objects despite a permissive policy", async () => {
  await admin.query(
    "insert into storage.objects(bucket_id,name) values('dylan-staging-private','synthetic.json')",
  );
  assert.equal(
    (
      await a.query(
        "select * from storage.objects where bucket_id='dylan-staging-private'",
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await anonymous.query(
        "select * from storage.objects where bucket_id='dylan-staging-private'",
      )
    ).rowCount,
    0,
  );
  await assert.rejects(
    a.query(
      "insert into storage.objects(bucket_id,name) values('dylan-staging-private','attack.json')",
    ),
    /row-level security/,
  );
  assert.equal(
    (
      await b.query(
        "delete from storage.objects where bucket_id='dylan-staging-private'",
      )
    ).rowCount,
    0,
  );
});
test("expired sessions and administrator bans are denied before JWT expiry", async () => {
  await admin.query(
    "update auth.sessions set not_after=now()-interval '1 minute' where id=$1",
    [SB],
  );
  await assert.rejects(read(b), /no longer active/);
  await admin.query("update auth.sessions set not_after=null where id=$1", [
    SB,
  ]);
  await admin.query(
    "update auth.users set banned_until=now()+interval '1 hour' where id=$1",
    [B],
  );
  await assert.rejects(read(b), /no longer active/);
  await admin.query("update auth.users set banned_until=null where id=$1", [B]);
  assert((await read(b)).data);
});
test("revoked sessions and disabled staging accounts immediately fail server authorization", async () => {
  await admin.query("delete from auth.sessions where id=$1", [SB]);
  await assert.rejects(read(b), /no longer active/);
  await assert.rejects(
    command(b, {
      action: "upsert",
      collection: "tasks",
      record: task("revoked"),
      expectedRevision: 0,
      expectedRecordRevision: 0,
    }),
    /no longer active/,
  );
  await admin.query(
    "update public.dylan_staging_accounts set enabled=false where user_id=$1",
    [A],
  );
  await assert.rejects(read(a), /not authorized/);
  await admin.query(
    "update public.dylan_staging_accounts set enabled=true where user_id=$1",
    [A],
  );
});
test("all private tables have forced RLS and only owner-read policies, all helper functions are nonpublic", async () => {
  const tables = (
    await admin.query(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
    )
  ).rows;
  assert.equal(tables.length, 15);
  for (const row of tables) {
    assert(row.relrowsecurity);
    assert(row.relforcerowsecurity);
  }
  const policies = (
    await admin.query(
      "select cmd,roles from pg_policies where schemaname='public'",
    )
  ).rows;
  assert.equal(policies.length, 15);
  for (const policy of policies) assert.equal(policy.cmd, "SELECT");
  const functions = (
    await admin.query(
      "select proname,prosecdef,proconfig from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and proname like 'dylan_%'",
    )
  ).rows;
  for (const f of functions) {
    assert(f.prosecdef);
    assert(f.proconfig.includes("search_path=pg_catalog"));
  }
});

test("operational rollback disables RPC access without destroying rows or snapshots", async () => {
  const before = (await admin.query("select count(*)::int n from public.tasks"))
    .rows[0].n;
  const snapshots = (
    await admin.query("select count(*)::int n from public.workspace_snapshots")
  ).rows[0].n;
  const accounts = (
    await admin.query(
      "select user_id,enabled from public.dylan_staging_accounts",
    )
  ).rows;
  await admin.query(
    await fs.readFile("supabase/rollback/disable_cloud.sql", "utf8"),
  );
  await assert.rejects(read(a), /permission denied/);
  assert.equal(
    (await admin.query("select count(*)::int n from public.tasks")).rows[0].n,
    before,
  );
  assert.equal(
    (
      await admin.query(
        "select count(*)::int n from public.workspace_snapshots",
      )
    ).rows[0].n,
    snapshots,
  );
  // Explicit test-only recovery of the exact grants revoked by the operational rollback.
  await admin.query(
    "grant execute on function dylan_private.actor(),public.dylan_read(),public.dylan_export(),public.dylan_command(jsonb) to authenticated",
  );
  for (const account of accounts)
    await admin.query(
      "update public.dylan_staging_accounts set enabled=$1 where user_id=$2",
      [account.enabled, account.user_id],
    );
  assert((await read(a)).data);
});
