import {
  test as nodeTest,
  before as nodeBefore,
  after as nodeAfter,
  describe,
} from "node:test";
import {
  safeTest,
  sanitized,
  cleanupSynthetic,
  assertPublishableKey,
} from "./staging-safety.mjs";
import { operationCases } from "./hosted-operation-cases.mjs";
const test = safeTest(nodeTest);
const before = (action) => nodeBefore(() => sanitized("Hosted setup", action));
const after = (action) => nodeAfter(() => sanitized("Hosted cleanup", action));
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const required = [
  "DYLAN_STAGING_URL",
  "DYLAN_STAGING_PROJECT_REF",
  "DYLAN_STAGING_PUBLISHABLE_KEY",
  "DYLAN_STAGING_SECRET_KEY",
  "DYLAN_STAGING_DB_URL",
  "DYLAN_STAGING_TEST_APPROVED",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  test(
    "HOSTED SUPABASE SECURITY UNVERIFIED",
    { skip: "Missing secure environment configuration: " + missing.join(", ") },
    () => {},
  );
} else {
  const cfg = Object.fromEntries(required.map((k) => [k, process.env[k]]));
  let base, dburl;
  try {
    base = new URL(cfg.DYLAN_STAGING_URL);
    dburl = new URL(cfg.DYLAN_STAGING_DB_URL);
  } catch {
    throw Error("Invalid secure staging URL configuration.");
  }
  if (
    cfg.DYLAN_STAGING_TEST_APPROVED !== "1" ||
    base.origin !== `https://${cfg.DYLAN_STAGING_PROJECT_REF}.supabase.co` ||
    base.pathname !== "/" ||
    !cfg.DYLAN_STAGING_PROJECT_REF ||
    !(
      dburl.hostname === `db.${cfg.DYLAN_STAGING_PROJECT_REF}.supabase.co` ||
      (dburl.hostname.endsWith(".pooler.supabase.com") &&
        decodeURIComponent(dburl.username) ===
          `postgres.${cfg.DYLAN_STAGING_PROJECT_REF}`)
    )
  )
    throw Error(
      "Only an explicitly approved isolated staging project/DB pair can be tested.",
    );
  assertPublishableKey(cfg.DYLAN_STAGING_PUBLISHABLE_KEY);
  const db = new pg.Client({
    connectionString: cfg.DYLAN_STAGING_DB_URL,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 30000,
    query_timeout: 30000,
  });
  if (
    !db.connectionParameters.ssl ||
    db.connectionParameters.ssl.rejectUnauthorized === false
  )
    throw Error("Staging database TLS certificate verification is required.");
  let transportFailed = false;
  db.on("error", () => {
    transportFailed = true;
  });
  const runId = randomUUID();
  const accounts = [];
  const generatedEmails = [];
  const objects = [];
  let a, b;
  async function request(
    path,
    {
      token,
      key = cfg.DYLAN_STAGING_PUBLISHABLE_KEY,
      method = "GET",
      body,
    } = {},
  ) {
    const response = await fetch(base.origin + path, {
      method,
      signal: AbortSignal.timeout(30000),
      headers: {
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    return { status: response.status, body: result, headers: response.headers };
  }
  const rpc = (name, token, body = {}) =>
    request("/rest/v1/rpc/" + name, { token, method: "POST", body });
  async function read(user) {
    const r = await rpc("dylan_read", user.token);
    assert.equal(r.status, 200);
    return r.body;
  }
  async function provision() {
    const email = `dylan-synthetic-${randomUUID()}@example.invalid`,
      password = randomUUID() + randomUUID();
    generatedEmails.push(email);
    const created = await request("/auth/v1/admin/users", {
      key: cfg.DYLAN_STAGING_SECRET_KEY,
      token: cfg.DYLAN_STAGING_SECRET_KEY,
      method: "POST",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { dylan_test_run: runId },
      },
    });
    assert.equal(
      created.status,
      200,
      "Staging admin could not create synthetic account",
    );
    const id = created.body.id;
    accounts.push(id);
    await db.query(
      "insert into public.dylan_staging_accounts(user_id,enabled) values($1,true)",
      [id],
    );
    const logged = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(logged.status, 200, "Synthetic staging login failed");
    return {
      id,
      email,
      password,
      token: logged.body.access_token,
      refreshToken: logged.body.refresh_token,
    };
  }
  before(async () => {
    await db.connect();
    const versions = (
      await db.query(
        "select version from supabase_migrations.schema_migrations order by version",
      )
    ).rows.map((r) => r.version);
    assert.deepEqual(
      versions,
      [
        "202610080001",
        "202610080002",
        "202610080003",
        "202610090004",
        "202610090005",
        "202610090006",
      ],
      "Apply approved six-migration schema before hosted verification",
    );
    // Explicit allowlisting protects private data, but public sign-up must independently be disabled.
    const settings = await request("/auth/v1/settings");
    assert.equal(settings.status, 200);
    assert.equal(
      settings.body.disable_signup,
      true,
      "Disable staging public signups before running",
    );
    a = await provision();
    b = await provision();
  });
  after(async () => {
    let discoveryFailed = false;
    try {
      const found = await db.query(
        "select id from auth.users where email=any($1::text[]) and raw_user_meta_data->>'dylan_test_run'=$2",
        [generatedEmails, runId],
      );
      for (const row of found.rows)
        if (!accounts.includes(row.id)) accounts.push(row.id);
    } catch {
      discoveryFailed = true;
    }
    await cleanupSynthetic({
      objects,
      accounts,
      removeObjects: async (prefixes) => {
        const r = await request("/storage/v1/object/dylan-staging-private", {
          key: cfg.DYLAN_STAGING_SECRET_KEY,
          token: cfg.DYLAN_STAGING_SECRET_KEY,
          method: "DELETE",
          body: { prefixes },
        });
        assert([200, 204].includes(r.status));
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from storage.objects where bucket_id='dylan-staging-private' and name=any($1::text[])",
              [prefixes],
            )
          ).rows[0].n,
          0,
        );
      },
      removeAccount: async (id) => {
        const r = await request("/auth/v1/admin/users/" + id, {
          key: cfg.DYLAN_STAGING_SECRET_KEY,
          token: cfg.DYLAN_STAGING_SECRET_KEY,
          method: "DELETE",
        });
        assert([200, 204].includes(r.status));
      },
      verifyAccount: async (id) => {
        for (const table of [
          "auth.users",
          "auth.sessions",
          "public.dylan_staging_accounts",
          "public.account_workspaces",
          "public.workspace_snapshots",
          "public.workspace_operation_receipts",
          "public.workspace_deletion_receipts",
          "public.workspace_preferences",
          "public.fitness_goals",
          "public.tasks",
          "public.courses",
          "public.school_work",
          "public.weight_entries",
          "public.daily_nutrition",
          "public.workout_entries",
          "public.habits",
          "public.important_dates",
          "public.commitment_series",
          "public.weekly_reflections",
        ]) {
          const column = table === "auth.users" ? "id" : "user_id";
          assert.equal(
            (
              await db.query(
                `select count(*)::int n from ${table} where ${column}=$1`,
                [id],
              )
            ).rows[0].n,
            0,
          );
        }
      },
      close: () => db.end(),
    });
    assert.equal(transportFailed, false, "Staging database transport failed");
    assert.equal(
      discoveryFailed,
      false,
      "Synthetic account discovery incomplete",
    );
  });
  const task = (id) => ({
    id,
    name: "Synthetic " + id,
    category: "Personal",
    priority: "High",
    due: "2026-10-08",
    completed: false,
    recurring: false,
  });
  test("real Supabase Auth identities are distinct and anonymous/invalid credentials are denied", async () => {
    assert.notEqual(a.id, b.id);
    assert([401, 403].includes((await rpc("dylan_read")).status));
    assert(
      [401, 403].includes((await rpc("dylan_read", "not-a-token")).status),
    );
  });
  test("hosted policies and helper grants are default-deny and forced", async () => {
    const rows = (
      await db.query(
        "select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname=any($1::text[])",
        [
          [
            "dylan_staging_accounts",
            "account_workspaces",
            "workspace_preferences",
            "fitness_goals",
            "tasks",
            "courses",
            "school_work",
            "weight_entries",
            "daily_nutrition",
            "workout_entries",
            "habits",
            "important_dates",
            "commitment_series",
            "weekly_reflections",
            "workspace_snapshots",
          ],
        ],
      )
    ).rows;
    assert.equal(rows.length, 15);
    for (const r of rows) {
      assert(r.relrowsecurity);
      assert(r.relforcerowsecurity);
    }
    const grants = (
      await db.query(
        "select has_function_privilege('authenticated','dylan_private.export_state(uuid)','EXECUTE') as leaked",
      )
    ).rows;
    assert.equal(grants[0].leaked, false);
    const unsafe = await db.query(
      `
      select c.relname, r.role from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      cross join (values ('anon'),('authenticated')) r(role)
      where n.nspname='public' and c.relname=any($1::text[])
      and (has_table_privilege(r.role,c.oid,'INSERT') or has_table_privilege(r.role,c.oid,'UPDATE') or has_table_privilege(r.role,c.oid,'DELETE') or has_table_privilege(r.role,c.oid,'TRUNCATE'))`,
      [rows.map((r) => r.relname)],
    );
    assert.deepEqual(unsafe.rows, []);
    const helpers = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dylan_private' and (has_function_privilege('anon',p.oid,'EXECUTE') or (p.proname <> 'actor' and has_function_privilege('authenticated',p.oid,'EXECUTE')))`,
    );
    assert.deepEqual(helpers.rows, []);
    for (const table of rows.map((r) => r.relname)) {
      const foreign = await request(
        "/rest/v1/" + table + "?user_id=eq." + a.id,
        { token: b.token },
      );
      assert.equal(foreign.status, 200);
      assert.deepEqual(foreign.body, []);
    }
  });
  test("hosted direct writes/owner spoofing are forbidden and foreign records remain invisible", async () => {
    const created = await rpc("dylan_command", a.token, {
      command: {
        action: "upsert",
        collection: "tasks",
        record: task("a-only"),
        expectedRevision: 0,
        expectedRecordRevision: 0,
      },
    });
    assert.equal(created.status, 200);
    const foreign = await request("/rest/v1/tasks?user_id=eq." + a.id, {
      token: b.token,
    });
    assert.equal(foreign.status, 200);
    assert.deepEqual(foreign.body, []);
    for (const method of ["POST", "PATCH", "DELETE"])
      assert(
        [401, 403].includes(
          (
            await request("/rest/v1/tasks?user_id=eq." + a.id, {
              token: b.token,
              method,
              body:
                method === "DELETE"
                  ? undefined
                  : { user_id: a.id, ...task("attack") },
            })
          ).status,
        ),
      );
    const spoof = await rpc("dylan_command", b.token, {
      command: {
        action: "upsert",
        collection: "tasks",
        record: task("spoof"),
        expectedRevision: 0,
        expectedRecordRevision: 0,
        user_id: a.id,
      },
    });
    assert.equal(spoof.status, 400);
  });
  test("hosted owner-scoped foreign key rejects cross-account academic links", async () => {
    let current = await read(a);
    const course = {
      id: "a-course",
      name: "Synthetic course",
      code: "101",
      instructor: "Synthetic",
      grade: null,
      notes: "",
    };
    assert.equal(
      (
        await rpc("dylan_command", a.token, {
          command: {
            action: "upsert",
            collection: "courses",
            record: course,
            expectedRevision: current.revision,
            expectedRecordRevision: 0,
          },
        })
      ).status,
      200,
    );
    const bad = await rpc("dylan_command", b.token, {
      command: {
        action: "upsert",
        collection: "assignments",
        record: {
          id: "invalid",
          name: "Synthetic exam",
          courseId: "a-course",
          due: "2026-10-08",
          type: "Exam",
          completed: false,
        },
        expectedRevision: 0,
        expectedRecordRevision: 0,
      },
    });
    assert.equal(bad.status, 409);
    assert.equal((await read(b)).revision, 0);
  });
  test("hosted exports/snapshots/restores are private and invalid restore changes nothing", async () => {
    assert.deepEqual((await rpc("dylan_export", b.token)).body.tasks, []);
    const list = await request(
      "/rest/v1/workspace_snapshots?select=id,revision&order=created_at.desc",
      { token: a.token },
    );
    assert.equal(list.status, 200);
    const snap = list.body[0];
    const foreign = await request(
      "/rest/v1/workspace_snapshots?id=eq." + snap.id,
      { token: b.token },
    );
    assert.deepEqual(foreign.body, []);
    const bad = await rpc("dylan_command", b.token, {
      command: {
        action: "restore",
        snapshotId: snap.id,
        confirmation: "RESTORE MY STAGING SNAPSHOT",
        expectedRevision: 0,
      },
    });
    assert.equal(bad.status, 403);
    assert.equal((await read(b)).revision, 0);
  });
  test("hosted simultaneous commands conflict and successful restore advances revisions", async () => {
    const current = await read(a);
    const results = await Promise.all(
      ["race1", "race2"].map((id) =>
        rpc("dylan_command", a.token, {
          command: {
            action: "upsert",
            collection: "tasks",
            record: task(id),
            expectedRevision: current.revision,
            expectedRecordRevision: 0,
          },
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const snapshot = (
      await request(
        "/rest/v1/workspace_snapshots?select=id,payload&order=created_at.desc",
        { token: a.token },
      )
    ).body[0];
    const latest = await read(a);
    const restored = await rpc("dylan_command", a.token, {
      command: {
        action: "restore",
        snapshotId: snapshot.id,
        confirmation: "RESTORE MY STAGING SNAPSHOT",
        expectedRevision: latest.revision,
      },
    });
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.data, snapshot.payload);
    assert.equal(restored.body.revision, latest.revision + 1);
  });
  test("hosted quarantine storage denies listing/uploading/downloading via actual Storage API", async () => {
    const path = a.id + "/synthetic-sentinel.json";
    objects.push(path);
    const seeded = await request(
      "/storage/v1/object/dylan-staging-private/" + path,
      {
        key: cfg.DYLAN_STAGING_SECRET_KEY,
        token: cfg.DYLAN_STAGING_SECRET_KEY,
        method: "POST",
        body: { synthetic: true },
      },
    );
    assert([200, 201].includes(seeded.status));
    const listing = await request(
      "/storage/v1/object/list/dylan-staging-private",
      { token: a.token, method: "POST", body: { prefix: "", limit: 10 } },
    );
    if (listing.status === 200) assert.deepEqual(listing.body, []);
    else assert([400, 401, 403].includes(listing.status));
    objects.push(a.id + "/synthetic.json");
    const upload = await fetch(
      base.origin +
        "/storage/v1/object/dylan-staging-private/" +
        a.id +
        "/synthetic.json",
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          apikey: cfg.DYLAN_STAGING_PUBLISHABLE_KEY,
          Authorization: "Bearer " + a.token,
          "Content-Type": "application/json",
        },
        body: '{"synthetic":true}',
      },
    );
    assert([400, 401, 403].includes(upload.status));
    const download = await request(
      "/storage/v1/object/dylan-staging-private/" + path,
      { token: b.token },
    );
    assert([400, 401, 403, 404].includes(download.status));
  });
  test("hosted password authentication rejects incorrect passwords and verifies token identity", async () => {
    const bad = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email: a.email, password: randomUUID() },
    });
    assert([400, 401, 403].includes(bad.status));
    for (const user of [a, b]) {
      const identity = await request("/auth/v1/user", { token: user.token });
      assert.equal(identity.status, 200);
      assert.equal(identity.body.id, user.id);
    }
  });
  test("hosted allowlisting cannot be bypassed by authenticated users or user metadata", async () => {
    const user = await provision();
    await db.query(
      "delete from public.dylan_staging_accounts where user_id=$1",
      [user.id],
    );
    const metadata = await request("/auth/v1/user", {
      token: user.token,
      method: "PUT",
      body: {
        data: {
          enabled: true,
          synthetic_only: true,
          role: "admin",
          entitlements: ["all"],
        },
      },
    });
    assert.equal(metadata.status, 200);
    for (const name of ["dylan_read", "dylan_export", "dylan_command"])
      assert(
        [401, 403].includes(
          (
            await rpc(
              name,
              user.token,
              name === "dylan_command"
                ? { command: { action: "restore" } }
                : {},
            )
          ).status,
        ),
      );
    await db.query(
      "insert into public.dylan_staging_accounts(user_id,enabled) values($1,false)",
      [user.id],
    );
    assert([401, 403].includes((await rpc("dylan_read", user.token)).status));
  });
  test("hosted server-side session expiry denies still-signed tokens and recovers after expiry reset", async () => {
    const user = await provision();
    const claims = JSON.parse(
      Buffer.from(user.token.split(".")[1], "base64url").toString(),
    );
    assert(claims.session_id);
    const original = await db.query(
      "select not_after from auth.sessions where id=$1 and user_id=$2",
      [claims.session_id, user.id],
    );
    assert.equal(original.rowCount, 1);
    try {
      await db.query(
        "update auth.sessions set not_after=now()-interval '1 minute' where id=$1 and user_id=$2",
        [claims.session_id, user.id],
      );
      for (const name of ["dylan_read", "dylan_export", "dylan_command"])
        assert(
          [401, 403].includes(
            (
              await rpc(
                name,
                user.token,
                name === "dylan_command"
                  ? { command: { action: "restore" } }
                  : {},
              )
            ).status,
          ),
        );
    } finally {
      await db.query(
        "update auth.sessions set not_after=$1 where id=$2 and user_id=$3",
        [original.rows[0].not_after, claims.session_id, user.id],
      );
    }
    assert.equal((await rpc("dylan_read", user.token)).status, 200);
  });
  test("hosted stale record revisions and weak/stale restores roll back records and snapshots", async () => {
    const current = await read(a);
    const snaps = await request(
      "/rest/v1/workspace_snapshots?order=created_at.asc,id.asc",
      { token: a.token },
    );
    assert.equal(snaps.status, 200);
    const existing = current.data.tasks[0];
    assert(existing);
    const commands = [
      {
        action: "upsert",
        collection: "tasks",
        record: { ...existing, name: "Should never save" },
        expectedRecordRevision:
          current.recordRevisions.tasks[existing.id] + 1000,
        expectedRevision: current.revision,
      },
      {
        action: "restore",
        snapshotId: snaps.body[0].id,
        confirmation: "yes",
        expectedRevision: current.revision,
      },
      {
        action: "restore",
        snapshotId: snaps.body[0].id,
        confirmation: "RESTORE MY STAGING SNAPSHOT",
        expectedRevision: current.revision - 1,
      },
    ];
    for (const command of commands) {
      const result = await rpc("dylan_command", a.token, { command });
      assert([400, 409].includes(result.status));
      assert.deepEqual(await read(a), current);
      assert.deepEqual(
        (
          await request(
            "/rest/v1/workspace_snapshots?order=created_at.asc,id.asc",
            { token: a.token },
          )
        ).body,
        snaps.body,
      );
    }
  });
  test("hosted anonymous exports and owner/foreign/anonymous storage reads are denied", async () => {
    assert([401, 403].includes((await rpc("dylan_export")).status));
    const bucket = await db.query(
      "select public from storage.buckets where id='dylan-staging-private'",
    );
    assert.equal(bucket.rowCount, 1);
    assert.equal(bucket.rows[0].public, false);
    for (const token of [a.token, b.token, undefined]) {
      const listing = await request(
        "/storage/v1/object/list/dylan-staging-private",
        { token, method: "POST", body: { prefix: a.id, limit: 100 } },
      );
      if (listing.status === 200) assert.deepEqual(listing.body, []);
      else assert([400, 401, 403].includes(listing.status));
      const download = await request(
        "/storage/v1/object/dylan-staging-private/" +
          a.id +
          "/synthetic-sentinel.json",
        { token },
      );
      assert([400, 401, 403, 404].includes(download.status));
    }
    for (const token of [b.token, undefined]) {
      const path = a.id + "/denied-" + randomUUID() + ".json";
      objects.push(path);
      const upload = await request(
        "/storage/v1/object/dylan-staging-private/" + path,
        { token, method: "POST", body: { synthetic: true } },
      );
      assert([400, 401, 403].includes(upload.status));
    }
    const publicRead = await request(
      "/storage/v1/object/public/dylan-staging-private/" +
        a.id +
        "/synthetic-sentinel.json",
    );
    assert([400, 401, 403, 404].includes(publicRead.status));
  });
  test("hosted account switching and logout do not expose A data to B or revoked tokens", async () => {
    assert((await read(a)).data.tasks.length > 0);
    assert.deepEqual((await read(b)).data.tasks, []);
    const loggedOut = await request("/auth/v1/logout?scope=global", {
      token: b.token,
      method: "POST",
    });
    assert([200, 204].includes(loggedOut.status));
    assert([401, 403].includes((await rpc("dylan_read", b.token)).status));
    assert(b.refreshToken);
    const refresh = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: b.refreshToken },
    });
    assert([400, 401, 403].includes(refresh.status));
  });
  describe("Hosted Phase 2A operations", { concurrency: false }, () => {
    operationCases({
      test,
      before,
      provision,
      rpc,
      request,
      db,
      revoke: async (u) => {
        const r = await request("/auth/v1/logout?scope=global", {
          token: u.token,
          method: "POST",
        });
        assert([200, 204].includes(r.status));
      },
    });
  });
}
