import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import {
  operationId,
  envelope,
  mutation,
  syntheticTask,
  domainRecords,
} from "./operation-fixtures.mjs";
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
let upgradeBefore, upgradeAfter, upgradePositions;
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
  const migrations = (await fs.readdir("supabase/migrations")).sort();
  for (const file of migrations.slice(0, 3))
    await admin.query(await fs.readFile("supabase/migrations/" + file, "utf8"));
  const U = "99999999-9999-4999-8999-999999999999",
    SU = "99999999-9999-4999-8999-999999999998";
  await admin.query("insert into auth.users(id) values($1)", [U]);
  await admin.query("insert into auth.sessions(id,user_id) values($1,$2)", [
    SU,
    U,
  ]);
  await admin.query(
    "insert into public.dylan_staging_accounts(user_id,enabled) values($1,true)",
    [U],
  );
  const upgradeUser = await user(U, SU);
  try {
    for (const [kind, record] of domainRecords("upgrade"))
      await upsert(upgradeUser, kind, record);
    await upsert(upgradeUser, "tasks", syntheticTask("a-upgrade"));
    upgradeBefore = await read(upgradeUser);
    // The disable procedure must still work before the new RPCs exist.
    await admin.query(
      await fs.readFile("supabase/rollback/disable_cloud.sql", "utf8"),
    );
    await assert.rejects(read(upgradeUser), /permission denied/);
    await admin.query(
      "grant execute on function dylan_private.actor(),public.dylan_read(),public.dylan_export(),public.dylan_command(jsonb) to authenticated",
    );
    await admin.query(
      "update public.dylan_staging_accounts set enabled=true where user_id=$1",
      [U],
    );
    assert.deepEqual(await read(upgradeUser), upgradeBefore);
    for (const file of migrations.slice(3))
      await admin.query(
        await fs.readFile("supabase/migrations/" + file, "utf8"),
      );
    upgradeAfter = await read(upgradeUser);
    upgradePositions = [];
    for (const kind of Object.keys(upgradeBefore.recordRevisions)) {
      const table = (
        await admin.query("select dylan_private.model($1)->>'table' as name", [
          kind,
        ])
      ).rows[0].name;
      upgradePositions.push(
        (
          await admin.query(
            `select position from public.${table} where user_id=$1 order by position`,
            [U],
          )
        ).rows.map((r) => Number(r.position)),
      );
    }
  } finally {
    await upgradeUser.end();
  }
  await admin.query("delete from auth.sessions where user_id=$1", [U]);
  await admin.query("delete from auth.users where id=$1", [U]);
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
      `insert into public.school_work(user_id,id,position,present_fields,name,"courseId",due,type,completed) values($1,'cross-owner',10000,'{}','x','only-a','2026-10-09','Exam',false)`,
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
  assert.equal(tables.length, 17);
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
    "grant execute on function dylan_private.actor(),public.dylan_read(),public.dylan_export(),public.dylan_command(jsonb),public.dylan_execute_operation(jsonb),public.dylan_operation_status(uuid) to authenticated",
  );
  for (const account of accounts)
    await admin.query(
      "update public.dylan_staging_accounts set enabled=$1 where user_id=$2",
      [account.enabled, account.user_id],
    );
  assert((await read(a)).data);
});

// Phase 2A tests execute real SQL under authenticated roles, never mocked authorization.
const execute = (client, request) =>
  call(client, "dylan_execute_operation", request);
const fresh = async (client, operation, id) =>
  execute(client, envelope((await read(client)).revision, operation, id));
const status = async (client, id) =>
  (
    await client.query(
      "select public.dylan_operation_status($1::uuid) result",
      [id],
    )
  ).rows[0].result;
async function checkpoint(client, who) {
  return {
    workspace: await read(client),
    snapshots: (
      await admin.query(
        "select * from public.workspace_snapshots where user_id=$1 order by id",
        [who],
      )
    ).rows,
    receipts: (
      await admin.query(
        "select * from public.workspace_operation_receipts where user_id=$1 order by operation_id",
        [who],
      )
    ).rows,
    deletions: (
      await admin.query(
        "select * from public.workspace_deletion_receipts where user_id=$1 order by id",
        [who],
      )
    ).rows,
    positions: (
      await admin.query(
        [
          ["tasks", "tasks"],
          ["courses", "courses"],
          ["assignments", "school_work"],
          ["weights", "weight_entries"],
          ["nutrition", "daily_nutrition"],
          ["workouts", "workout_entries"],
          ["habits", "habits"],
          ["dates", "important_dates"],
          ["commitments", "commitment_series"],
          ["weeklyReflections", "weekly_reflections"],
        ]
          .map(
            ([collection, table]) =>
              `select '${collection}' collection,id,position from public.${table} where user_id=$1`,
          )
          .join(" union all ") + " order by collection,position,id",
        [who],
      )
    ).rows,
  };
}
test("additive upgrade preserves all ten populated domains, existing revisions and ID-sorted order", async () => {
  await admin.query(
    "insert into auth.sessions(id,user_id) values($1,$2) on conflict do nothing",
    [SB, B],
  );
  assert.deepEqual(upgradeAfter, upgradeBefore);
  assert.equal(upgradePositions.length, 10);
  for (const positions of upgradePositions)
    assert.deepEqual(
      positions,
      positions.map((_, i) => i),
    );
});
test("atomic batch creates parent and child with one revision/snapshot and preserves optional/unknown fields", async () => {
  const before = await read(a),
    count = (
      await a.query("select count(*)::int n from public.workspace_snapshots")
    ).rows[0].n;
  const records = domainRecords("operation");
  const result = await execute(
    a,
    envelope(before.revision, {
      action: "batch",
      mutations: records
        .slice()
        .reverse()
        .map(([kind, record]) => mutation(kind, record)),
    }),
  );
  assert.equal(result.workspace.revision, before.revision + 1);
  assert.equal(result.receipt.committedRevision, before.revision + 1);
  assert.equal(result.replayed, false);
  for (const [kind, record] of records) {
    const exported = result.workspace.data[kind].find(
      (r) => r.id === record.id,
    );
    if (kind === "weeklyReflections") {
      assert.equal(Date.parse(exported.savedAt), Date.parse(record.savedAt));
      assert.deepEqual({ ...exported, savedAt: record.savedAt }, record);
    } else assert.deepEqual(exported, record);
    assert.equal(
      result.workspace.recordRevisions[kind][record.id],
      before.revision + 1,
    );
  }
  assert.equal(
    (await a.query("select count(*)::int n from public.workspace_snapshots"))
      .rows[0].n,
    Math.min(count + 1, 5),
  );
});
test("failed final mutation rolls back earlier records, snapshots, ordering and receipts", async () => {
  const before = await checkpoint(a, A);
  await assert.rejects(
    fresh(a, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("rollback-first")),
        mutation("assignments", {
          id: "rollback-final",
          name: "Synthetic",
          courseId: "missing-parent",
          due: "2026-10-09",
          type: "Exam",
          completed: false,
        }),
      ],
    }),
    /foreign key/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
});
test("stale workspace/record revisions and malformed batch limits leave no state or receipts", async () => {
  const before = await checkpoint(a, A),
    record = before.workspace.data.tasks[0];
  for (const request of [
    envelope(
      before.workspace.revision - 1,
      mutation("tasks", syntheticTask("stale-workspace")),
    ),
    envelope(before.workspace.revision, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("stale-first")),
        mutation("tasks", record, 999999),
      ],
    }),
    envelope(before.workspace.revision, { action: "batch", mutations: [] }),
    envelope(before.workspace.revision, {
      action: "batch",
      mutations: Array.from({ length: 101 }, (_, i) =>
        mutation("tasks", syntheticTask("limit" + i)),
      ),
    }),
    envelope(before.workspace.revision, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("duplicate")),
        mutation("tasks", syntheticTask("duplicate")),
      ],
    }),
    envelope(before.workspace.revision, {
      action: "batch",
      mutations: [{ action: "batch", mutations: [] }],
    }),
    envelope(
      before.workspace.revision,
      mutation("tasks", {
        ...syntheticTask("oversized"),
        extra: "x".repeat(270000),
      }),
    ),
  ]) {
    await assert.rejects(execute(a, request));
    assert.deepEqual(await checkpoint(a, A), before);
  }
});
test("ordering across all collections supports edits, append, exact reorder and snapshot restore", async () => {
  let current = await read(a);
  for (const kind of Object.keys(current.recordRevisions)) {
    const ids = current.data[kind].map((r) => r.id).reverse();
    const reordered = await fresh(a, {
      action: "reorder",
      collection: kind,
      ids,
    });
    assert.deepEqual(
      reordered.workspace.data[kind].map((r) => r.id),
      ids,
    );
    assert.deepEqual(
      reordered.workspace.recordRevisions,
      current.recordRevisions,
    );
    current = reordered.workspace;
  }
  const existing = current.data.tasks[0],
    previousOrder = current.data.tasks.map((r) => r.id);
  const edited = await fresh(
    a,
    mutation(
      "tasks",
      { ...existing, name: "Synthetic edited" },
      current.recordRevisions.tasks[existing.id],
    ),
  );
  assert.deepEqual(
    edited.workspace.data.tasks.map((r) => r.id),
    previousOrder,
  );
  const inserted = await fresh(
    a,
    mutation("tasks", syntheticTask("z-appended")),
  );
  assert.deepEqual(
    inserted.workspace.data.tasks.map((r) => r.id),
    [...previousOrder, "z-appended"],
  );
  const snapshot = (
    await a.query(
      "select id,payload from public.workspace_snapshots order by created_at desc,id desc limit 1",
    )
  ).rows[0];
  const restored = await command(a, {
    action: "restore",
    snapshotId: snapshot.id,
    confirmation: "RESTORE MY STAGING SNAPSHOT",
    expectedRevision: inserted.workspace.revision,
  });
  assert.deepEqual(restored.data, snapshot.payload);
  const before = await checkpoint(a, A);
  for (const ids of [[existing.id, existing.id], ["foreign-or-missing"], []]) {
    await assert.rejects(
      fresh(a, { action: "reorder", collection: "tasks", ids }),
    );
    assert.deepEqual(await checkpoint(a, A), before);
  }
});
test("account-scoped idempotency replays without snapshots and rejects changed payload", async () => {
  const request = envelope(
    (await read(a)).revision,
    mutation("tasks", syntheticTask("idempotent")),
  );
  const first = await execute(a, request),
    after = await checkpoint(a, A);
  assert.deepEqual((await execute(a, request)).receipt, first.receipt);
  assert.equal((await execute(a, request)).replayed, true);
  assert.deepEqual(await checkpoint(a, A), after);
  const reordered = {
    operation: request.operation,
    expectedRevision: request.expectedRevision,
    operationId: request.operationId,
    version: 1,
  };
  assert.equal((await execute(a, reordered)).replayed, true);
  await assert.rejects(
    execute(a, {
      ...request,
      operation: { ...request.operation, record: syntheticTask("different") },
    }),
    /payload conflict/,
  );
  assert.deepEqual(await checkpoint(a, A), after);
  assert.equal((await status(a, request.operationId)).status, "committed");
  assert.equal((await status(b, request.operationId)).status, "not-found");
  const independent = await fresh(
    b,
    mutation("tasks", syntheticTask("b-idempotent")),
    request.operationId,
  );
  assert.equal(independent.replayed, false);
  assert.equal(
    (await status(b, request.operationId)).receipt.committedRevision,
    independent.workspace.revision,
  );
});
test("replay returns original receipt with fresh workspace after intervening writes", async () => {
  const request = envelope(
    (await read(a)).revision,
    mutation("tasks", syntheticTask("replay-old")),
  );
  const first = await execute(a, request);
  const next = await fresh(a, mutation("tasks", syntheticTask("replay-new")));
  const replay = await execute(a, request);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.workspace.revision, next.workspace.revision);
  assert(replay.workspace.revision > replay.receipt.committedRevision);
});
test("UUIDv7 admission rejects v4, expired and future IDs; cleanup cannot allow expired execution", async () => {
  const before = await checkpoint(a, A);
  for (const id of [
    "11111111-1111-4111-8111-111111111111",
    operationId(Date.now() - 25 * 3600000),
    operationId(Date.now() + 6 * 60000),
  ])
    await assert.rejects(
      fresh(a, mutation("tasks", syntheticTask("expired")), id),
      /UUIDv7|admission/,
    );
  assert.deepEqual(await checkpoint(a, A), before);
  const id = operationId(Date.now() - 8 * 86400000);
  await admin.query(
    "insert into public.workspace_operation_receipts(user_id,operation_id,request_fingerprint,committed_revision,operation_kind,committed_at) values($1,$2,repeat('a',64),1,'upsert',now()-interval '8 days')",
    [A, id],
  );
  await admin.query("select dylan_private.cleanup_operation_receipts()");
  assert.equal((await status(a, id)).status, "expired");
  await assert.rejects(
    fresh(a, mutation("tasks", syntheticTask("expired-cleaned")), id),
    /admission/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
});
test("concurrent identical requests commit once; different requests at same revision have one winner", async () => {
  const second = await user(A, SA);
  try {
    const before = await read(a),
      request = envelope(
        before.revision,
        mutation("tasks", syntheticTask("concurrent-idempotent")),
      );
    const results = await Promise.all([
      execute(a, request),
      execute(second, request),
    ]);
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
    assert.equal((await read(a)).revision, before.revision + 1);
    const revision = (await read(a)).revision;
    const race = await Promise.allSettled([
      execute(
        a,
        envelope(
          revision,
          mutation("tasks", syntheticTask("operation-race-a")),
        ),
      ),
      execute(
        second,
        envelope(
          revision,
          mutation("tasks", syntheticTask("operation-race-b")),
        ),
      ),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      race.find((r) => r.status === "rejected").reason.code,
      "PT409",
    );
    assert.equal((await read(a)).revision, revision + 1);
    const mixedRevision = (await read(a)).revision;
    const mixed = await Promise.allSettled([
      execute(
        a,
        envelope(mixedRevision, mutation("tasks", syntheticTask("mixed-new"))),
      ),
      command(second, {
        action: "upsert",
        collection: "tasks",
        record: syntheticTask("mixed-legacy"),
        expectedRevision: mixedRevision,
        expectedRecordRevision: 0,
      }),
    ]);
    assert.equal(mixed.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await second.end();
  }
});
test("linked course deletion requires exact child inventory; overlap rolls back", async () => {
  const before = await checkpoint(a, A),
    id = "operation-course",
    rev = before.workspace.recordRevisions.courses[id],
    linked = {
      "operation-exam":
        before.workspace.recordRevisions.assignments["operation-exam"],
    };
  for (const inventory of [undefined, {}, { ...linked, unexpected: 1 }]) {
    await assert.rejects(
      fresh(a, {
        action: "delete",
        collection: "courses",
        id,
        expectedRecordRevision: rev,
        ...(inventory ? { expectedLinkedRevisions: inventory } : {}),
      }),
    );
    assert.deepEqual(await checkpoint(a, A), before);
  }
  await assert.rejects(
    fresh(a, {
      action: "batch",
      mutations: [
        {
          action: "delete",
          collection: "courses",
          id,
          expectedRecordRevision: rev,
          expectedLinkedRevisions: linked,
        },
        {
          action: "delete",
          collection: "assignments",
          id: "operation-exam",
          expectedRecordRevision: linked["operation-exam"],
        },
      ],
    }),
    /Overlapping/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
});
test("scoped course Undo restores child order and unknown fields without reverting unrelated edits", async () => {
  const current = await read(a),
    courseId = "operation-course",
    examId = "operation-exam";
  const savedCourse = current.data.courses.find((r) => r.id === courseId),
    savedExam = current.data.assignments.find((r) => r.id === examId);
  const deleted = await fresh(a, {
    action: "delete",
    collection: "courses",
    id: courseId,
    expectedRecordRevision: current.recordRevisions.courses[courseId],
    expectedLinkedRevisions: {
      [examId]: current.recordRevisions.assignments[examId],
    },
  });
  assert(!deleted.workspace.data.assignments.some((r) => r.id === examId));
  await fresh(a, mutation("tasks", syntheticTask("unrelated-after-delete")));
  const undoRequest = envelope((await read(a)).revision, {
    action: "undo",
    deletionId: deleted.receipt.deletionId,
  });
  const restored = await execute(a, undoRequest);
  assert.deepEqual(
    restored.workspace.data.courses.find((r) => r.id === courseId),
    savedCourse,
  );
  assert.deepEqual(
    restored.workspace.data.assignments.find((r) => r.id === examId),
    savedExam,
  );
  assert(
    restored.workspace.data.tasks.some(
      (r) => r.id === "unrelated-after-delete",
    ),
  );
  assert.deepEqual(
    restored.workspace.data.courses.map((r) => r.id),
    current.data.courses.map((r) => r.id),
  );
  assert.deepEqual(
    restored.workspace.data.assignments.map((r) => r.id),
    current.data.assignments.map((r) => r.id),
  );
  assert(
    restored.workspace.recordRevisions.courses[courseId] >
      current.recordRevisions.courses[courseId],
  );
  assert.equal((await execute(a, undoRequest)).replayed, true);
  const before = await checkpoint(a, A);
  await assert.rejects(
    fresh(a, { action: "undo", deletionId: deleted.receipt.deletionId }),
    /consumed/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
  await assert.rejects(
    fresh(b, { action: "undo", deletionId: deleted.receipt.deletionId }),
    /unavailable/,
  );
});
test("Undo survives snapshot rotation, rejects reused IDs/unique dates and enforces server expiry", async () => {
  let current = await read(a),
    id = "operation-weight";
  const deleted = await fresh(a, {
    action: "delete",
    collection: "weights",
    id,
    expectedRecordRevision: current.recordRevisions.weights[id],
  });
  await fresh(
    a,
    mutation("weights", {
      id: "replacement-date",
      date: "2025-01-01",
      value: 170,
    }),
  );
  const before = await checkpoint(a, A);
  await assert.rejects(
    fresh(a, { action: "undo", deletionId: deleted.receipt.deletionId }),
    /unique/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
  current = await read(a);
  await fresh(a, {
    action: "delete",
    collection: "weights",
    id: "replacement-date",
    expectedRecordRevision: current.recordRevisions.weights["replacement-date"],
  });
  for (let i = 0; i < 6; i++)
    await fresh(a, mutation("tasks", syntheticTask("rotation-undo-" + i)));
  await fresh(a, { action: "undo", deletionId: deleted.receipt.deletionId });
  current = await read(a);
  const deletedTask = await fresh(a, {
    action: "delete",
    collection: "tasks",
    id: "rotation-undo-0",
    expectedRecordRevision: current.recordRevisions.tasks["rotation-undo-0"],
  });
  await fresh(a, mutation("tasks", syntheticTask("rotation-undo-0")));
  await assert.rejects(
    fresh(a, { action: "undo", deletionId: deletedTask.receipt.deletionId }),
    /Record revision conflict/,
  );
  await admin.query(
    "update public.workspace_deletion_receipts set created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' where user_id=$1 and id=$2",
    [A, deletedTask.receipt.deletionId],
  );
  await assert.rejects(
    fresh(a, { action: "undo", deletionId: deletedTask.receipt.deletionId }),
    /expired/,
  );
});
test("receipt tables and helpers deny browser/anonymous access and owner spoofing", async () => {
  const before = await checkpoint(a, A);
  for (const table of [
    "workspace_operation_receipts",
    "workspace_deletion_receipts",
  ]) {
    for (const client of [a, b, anonymous])
      for (const sql of [
        `select * from public.${table}`,
        `delete from public.${table}`,
        `update public.${table} set user_id='${B}'`,
      ])
        await assert.rejects(client.query(sql), /permission denied/);
  }
  await assert.rejects(
    execute(
      anonymous,
      envelope(0, mutation("tasks", syntheticTask("anonymous"))),
    ),
    /permission denied/,
  );
  await assert.rejects(status(anonymous, operationId()), /permission denied/);
  for (const extra of [{ owner: A }, { user_id: A }, { entitlements: ["all"] }])
    await assert.rejects(
      execute(a, {
        ...envelope(
          before.workspace.revision,
          mutation("tasks", syntheticTask("spoof")),
        ),
        ...extra,
      }),
      /Invalid operation/,
    );
  const leaked = (
    await admin.query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dylan_private' and (has_function_privilege('anon',p.oid,'EXECUTE') or (p.proname<>'actor' and has_function_privilege('authenticated',p.oid,'EXECUTE')))",
    )
  ).rows;
  assert.deepEqual(leaked, []);
  await assert.rejects(
    a.query("select dylan_private.cleanup_operation_receipts()"),
    /permission denied/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
});
test("new endpoints reject expired/disabled/revoked sessions even for committed replays", async () => {
  const request = envelope(
    (await read(a)).revision,
    mutation("tasks", syntheticTask("authorization-replay")),
  );
  await execute(a, request);
  for (const change of ["expire", "disable", "ban", "revoke"]) {
    try {
      if (change === "expire")
        await admin.query(
          "update auth.sessions set not_after=now()-interval '1 minute' where id=$1",
          [SA],
        );
      if (change === "disable")
        await admin.query(
          "update public.dylan_staging_accounts set enabled=false where user_id=$1",
          [A],
        );
      if (change === "ban")
        await admin.query(
          "update auth.users set banned_until=now()+interval '1 hour' where id=$1",
          [A],
        );
      if (change === "revoke")
        await admin.query("delete from auth.sessions where id=$1", [SA]);
      await assert.rejects(
        execute(a, request),
        /not authorized|no longer active/,
      );
      await assert.rejects(
        status(a, request.operationId),
        /not authorized|no longer active/,
      );
    } finally {
      await admin.query(
        "update public.dylan_staging_accounts set enabled=true where user_id=$1",
        [A],
      );
      await admin.query("update auth.users set banned_until=null where id=$1", [
        A,
      ]);
      await admin.query(
        "insert into auth.sessions(id,user_id,not_after) values($1,$2,null) on conflict(id) do update set not_after=null",
        [SA, A],
      );
    }
  }
  const unapproved = await user(C, SC);
  try {
    await assert.rejects(execute(unapproved, request), /not authorized/);
    await assert.rejects(
      status(unapproved, request.operationId),
      /not authorized/,
    );
  } finally {
    await unapproved.end();
  }
});
test("new batch cross-owner references, authority spoofing and order membership fail without mutation", async () => {
  const before = await checkpoint(b, B);
  await assert.rejects(
    fresh(b, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("b-rollback")),
        mutation("assignments", {
          id: "b-foreign-course",
          name: "Synthetic",
          courseId: "operation-course",
          due: "2026-10-09",
          type: "Exam",
          completed: false,
        }),
      ],
    }),
    /foreign key/,
  );
  await assert.rejects(
    fresh(b, {
      action: "reorder",
      collection: "courses",
      ids: ["operation-course"],
    }),
    /membership/,
  );
  await assert.rejects(
    fresh(b, {
      action: "batch",
      mutations: [
        { ...mutation("tasks", syntheticTask("b-spoof")), user_id: A },
      ],
    }),
    /Invalid mutation/,
  );
  assert.deepEqual(await checkpoint(b, B), before);
});
test("concurrent different payloads with same operation ID produce one receipt and one conflict", async () => {
  const second = await user(A, SA);
  try {
    const revision = (await read(a)).revision,
      id = operationId();
    const race = await Promise.allSettled([
      execute(
        a,
        envelope(revision, mutation("tasks", syntheticTask("same-id-a")), id),
      ),
      execute(
        second,
        envelope(revision, mutation("tasks", syntheticTask("same-id-b")), id),
      ),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      race.find((r) => r.status === "rejected").reason.message,
      /payload conflict/,
    );
    assert.equal((await read(a)).revision, revision + 1);
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from public.workspace_operation_receipts where user_id=$1 and operation_id=$2",
          [A, id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await second.end();
  }
});
test("Undo preserves survivors after insertions/deletions/reorder; concurrent Undo commits once", async () => {
  const courseId = "undo-order-course";
  const records = [
    {
      id: courseId,
      name: "Synthetic",
      code: "SYN",
      instructor: "Synthetic",
      grade: null,
      notes: "",
    },
    ...Array.from({ length: 3 }, (_, i) => ({
      id: "undo-order-exam-" + i,
      name: "Synthetic exam",
      courseId,
      due: "2026-10-09",
      type: "Exam",
      completed: false,
    })),
  ];
  await fresh(a, {
    action: "batch",
    mutations: [
      mutation("courses", records[0]),
      ...records.slice(1).map((r) => mutation("assignments", r)),
    ],
  });
  let current = await read(a);
  const assignments = current.data.assignments.map((r) => r.id);
  const ids = [
    records[1].id,
    ...assignments.filter((id) => !records.slice(1).some((r) => r.id === id)),
    records[2].id,
    records[3].id,
  ];
  await fresh(a, { action: "reorder", collection: "assignments", ids });
  current = await read(a);
  const deletion = await fresh(a, {
    action: "delete",
    collection: "courses",
    id: courseId,
    expectedRecordRevision: current.recordRevisions.courses[courseId],
    expectedLinkedRevisions: Object.fromEntries(
      records
        .slice(1)
        .map((r) => [r.id, current.recordRevisions.assignments[r.id]]),
    ),
  });
  let survivors = deletion.workspace.data.assignments
    .map((r) => r.id)
    .reverse();
  await fresh(a, {
    action: "reorder",
    collection: "assignments",
    ids: survivors,
  });
  await fresh(
    a,
    mutation("assignments", {
      id: "undo-order-survivor",
      name: "Synthetic exam",
      courseId: "operation-course",
      due: "2026-10-09",
      type: "Exam",
      completed: false,
    }),
  );
  survivors = [...survivors, "undo-order-survivor"];
  const second = await user(A, SA);
  try {
    const revision = (await read(a)).revision;
    const results = await Promise.allSettled([
      fresh(a, { action: "undo", deletionId: deletion.receipt.deletionId }),
      execute(
        second,
        envelope(revision, {
          action: "undo",
          deletionId: deletion.receipt.deletionId,
        }),
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const restored = await read(a);
    assert.deepEqual(
      restored.data.assignments
        .filter((r) => survivors.includes(r.id))
        .map((r) => r.id),
      survivors,
    );
    for (const record of records.slice(1))
      assert.deepEqual(
        restored.data.assignments.find((r) => r.id === record.id),
        record,
      );
  } finally {
    await second.end();
  }
});
test("final uniqueness failure and failed Undo do not leave any committed receipt", async () => {
  const before = await checkpoint(a, A);
  // Last upsert creates a unique-date violation after the earlier task write.
  await assert.rejects(
    fresh(a, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("unique-rollback")),
        mutation("weights", {
          id: "duplicate-operation-date",
          date: "2025-01-01",
          value: 180,
        }),
      ],
    }),
    /unique/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
  await assert.rejects(
    fresh(a, {
      action: "undo",
      deletionId: "00000000-0000-4000-8000-000000000000",
    }),
    /unavailable/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
});
test("bounded cleanup preserves recent receipts, removes expired Undo payloads and remains operator-only", async () => {
  const recent = (
    await admin.query(
      "select count(*)::int n from public.workspace_operation_receipts",
    )
  ).rows[0].n;
  await admin.query(
    "insert into public.workspace_deletion_receipts(user_id,payload,created_at,expires_at) values($1,'{}',now()-interval '10 minutes',now()-interval '9 minutes')",
    [A],
  );
  const cleaned = (
    await admin.query(
      "select dylan_private.cleanup_operation_receipts() result",
    )
  ).rows[0].result;
  assert.equal(cleaned.operations, 0);
  assert(cleaned.deletions >= 1);
  assert.equal(
    (
      await admin.query(
        "select count(*)::int n from public.workspace_operation_receipts",
      )
    ).rows[0].n,
    recent,
  );
  await assert.rejects(
    b.query("select dylan_private.cleanup_operation_receipts()"),
    /permission denied/,
  );
});
test("operational disable blocks new endpoints while preserving populated receipts and recovery", async () => {
  const before = await checkpoint(a, A);
  try {
    await admin.query(
      await fs.readFile("supabase/rollback/disable_cloud.sql", "utf8"),
    );
    await assert.rejects(
      execute(
        a,
        envelope(
          before.workspace.revision,
          mutation("tasks", syntheticTask("disabled")),
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(status(a, operationId()), /permission denied/);
    assert.deepEqual(
      (
        await admin.query(
          "select * from public.workspace_operation_receipts where user_id=$1 order by operation_id",
          [A],
        )
      ).rows,
      before.receipts,
    );
    assert.deepEqual(
      (
        await admin.query(
          "select * from public.workspace_deletion_receipts where user_id=$1 order by id",
          [A],
        )
      ).rows,
      before.deletions,
    );
  } finally {
    await admin.query(
      "grant execute on function dylan_private.actor(),public.dylan_read(),public.dylan_export(),public.dylan_command(jsonb),public.dylan_execute_operation(jsonb),public.dylan_operation_status(uuid) to authenticated",
    );
    await admin.query(
      "update public.dylan_staging_accounts set enabled=true where user_id=any($1::uuid[])",
      [[A, B]],
    );
  }
  assert.deepEqual(await checkpoint(a, A), before);
});
test("ordering constraints are deferred but reject duplicate owner positions atomically", async () => {
  const before = await checkpoint(a, A);
  await admin.query("begin");
  try {
    await admin.query("update public.tasks set position=0 where user_id=$1", [
      A,
    ]);
    await assert.rejects(
      admin.query("set constraints all immediate"),
      /unique/,
    );
  } finally {
    await admin.query("rollback");
  }
  assert.deepEqual(await checkpoint(a, A), before);
});
test("maximum batch boundary commits and reserved portable fields remain inert", async () => {
  const before = await read(a);
  const result = await fresh(a, {
    action: "batch",
    mutations: Array.from({ length: 100 }, (_, i) =>
      mutation("tasks", {
        ...syntheticTask("boundary-" + i),
        position: 999,
        owner: B,
        entitlements: { paid: true },
      }),
    ),
  });
  assert.equal(result.workspace.revision, before.revision + 1);
  assert.equal(
    result.workspace.data.tasks.filter((r) => r.id.startsWith("boundary-"))
      .length,
    100,
  );
  const row = result.workspace.data.tasks.find((r) => r.id === "boundary-0");
  assert.equal(row.position, 999);
  assert.equal(row.owner, B);
  const persisted = (
    await admin.query(
      "select user_id,position from public.tasks where user_id=$1 and id='boundary-0'",
      [A],
    )
  ).rows[0];
  assert.equal(persisted.user_id, A);
  assert.notEqual(Number(persisted.position), 999);
});
test("unsafe revision overflow is rejected by both APIs without committing", async () => {
  const before = await checkpoint(a, A);
  try {
    await admin.query(
      "update public.account_workspaces set revision=9007199254740991 where user_id=$1",
      [A],
    );
    await assert.rejects(
      execute(
        a,
        envelope(
          Number.MAX_SAFE_INTEGER,
          mutation("tasks", syntheticTask("overflow-new")),
        ),
      ),
      /exhausted/,
    );
    await assert.rejects(
      command(a, {
        action: "upsert",
        collection: "tasks",
        record: syntheticTask("overflow-legacy"),
        expectedRevision: Number.MAX_SAFE_INTEGER,
        expectedRecordRevision: 0,
      }),
      /exhausted/,
    );
  } finally {
    await admin.query(
      "update public.account_workspaces set revision=$1 where user_id=$2",
      [before.workspace.revision, A],
    );
  }
  assert.deepEqual(await checkpoint(a, A), before);
});
test("receipt cleanup processes at most 1000 rows per invocation", async () => {
  const ids = Array.from({ length: 1001 }, () =>
    operationId(Date.now() - 8 * 86400000),
  );
  await admin.query(
    "insert into public.workspace_operation_receipts(user_id,operation_id,request_fingerprint,committed_revision,operation_kind,committed_at) select $1,id,repeat('b',64),1,'upsert',now()-interval '8 days' from unnest($2::uuid[]) id",
    [A, ids],
  );
  const first = (
    await admin.query(
      "select dylan_private.cleanup_operation_receipts() result",
    )
  ).rows[0].result;
  assert.equal(first.operations, 1000);
  const second = (
    await admin.query(
      "select dylan_private.cleanup_operation_receipts() result",
    )
  ).rows[0].result;
  assert.equal(second.operations, 1);
  for (const id of [ids[0], ids[1000]]) {
    assert.equal((await status(a, id)).status, "expired");
    await assert.rejects(
      fresh(a, mutation("tasks", syntheticTask("cleaned-expired")), id),
      /admission/,
    );
  }
});
test("preferences/goals participate in receipts and replay without extra snapshots", async () => {
  for (const operation of [
    {
      action: "preferences",
      preferences: {
        dashboard: { order: ["tasks", "fitness"], hidden: [] },
        future: { keep: true },
      },
    },
    {
      action: "goals",
      goals: {
        goalWeight: 155,
        fitnessGoals: {
          calories: null,
          protein: 100,
          steps: null,
          weeklyWorkouts: 3,
          future: { keep: true },
        },
      },
    },
  ]) {
    const req = envelope((await read(a)).revision, operation);
    const result = await execute(a, req),
      after = await checkpoint(a, A);
    assert.equal((await execute(a, req)).replayed, true);
    assert.deepEqual(await checkpoint(a, A), after);
    if (operation.action === "preferences")
      assert.deepEqual(
        result.workspace.data.preferences,
        operation.preferences,
      );
    else {
      assert.equal(result.workspace.data.goalWeight, 155);
      assert.deepEqual(
        result.workspace.data.fitnessGoals,
        operation.goals.fitnessGoals,
      );
    }
  }
});
test("batch cannot create or move school work into a course deleted in the same operation", async () => {
  const before = await checkpoint(a, A),
    id = "operation-course";
  const linked = Object.fromEntries(
    before.workspace.data.assignments
      .filter((r) => r.courseId === id)
      .map((r) => [r.id, before.workspace.recordRevisions.assignments[r.id]]),
  );
  const deletion = {
    action: "delete",
    collection: "courses",
    id,
    expectedRecordRevision: before.workspace.recordRevisions.courses[id],
    expectedLinkedRevisions: linked,
  };
  await assert.rejects(
    fresh(a, {
      action: "batch",
      mutations: [
        deletion,
        mutation("assignments", {
          id: "would-cascade-new",
          name: "Synthetic",
          courseId: id,
          due: "2026-10-09",
          type: "Exam",
          completed: false,
        }),
      ],
    }),
    /Overlapping/,
  );
  assert.deepEqual(await checkpoint(a, A), before);
  await assert.rejects(status(a, null), /UUIDv7/);
});
