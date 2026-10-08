import { test, before, after } from "node:test";
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
  const db = new pg.Client({
    connectionString: cfg.DYLAN_STAGING_DB_URL,
    ssl: { rejectUnauthorized: true },
  });
  if (
    !db.connectionParameters.ssl ||
    db.connectionParameters.ssl.rejectUnauthorized === false
  )
    throw Error("Staging database TLS certificate verification is required.");
  const accounts = [];
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
    return { status: response.status, body: result };
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
    const created = await request("/auth/v1/admin/users", {
      key: cfg.DYLAN_STAGING_SECRET_KEY,
      token: cfg.DYLAN_STAGING_SECRET_KEY,
      method: "POST",
      body: { email, password, email_confirm: true },
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
    return { id, token: logged.body.access_token };
  }
  before(async () => {
    await db.connect();
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
    if (objects.length) {
      const removed = await request(
        "/storage/v1/object/dylan-staging-private",
        {
          key: cfg.DYLAN_STAGING_SECRET_KEY,
          token: cfg.DYLAN_STAGING_SECRET_KEY,
          method: "DELETE",
          body: { prefixes: objects },
        },
      );
      assert(
        [200, 204].includes(removed.status),
        "Synthetic storage cleanup failed",
      );
    }
    for (const id of accounts) {
      const r = await request("/auth/v1/admin/users/" + id, {
        key: cfg.DYLAN_STAGING_SECRET_KEY,
        token: cfg.DYLAN_STAGING_SECRET_KEY,
        method: "DELETE",
      });
      assert(
        [200, 204].includes(r.status),
        "Synthetic account cleanup failed; remove test users manually",
      );
    }
    await db.end();
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
    objects.push(path);
    const listing = await request(
      "/storage/v1/object/list/dylan-staging-private",
      { token: a.token, method: "POST", body: { prefix: "", limit: 10 } },
    );
    if (listing.status === 200) assert.deepEqual(listing.body, []);
    else assert([400, 401, 403].includes(listing.status));
    const upload = await fetch(
      base.origin +
        "/storage/v1/object/dylan-staging-private/" +
        a.id +
        "/synthetic.json",
      {
        method: "POST",
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
  test("hosted account switching and logout do not expose A data to B or revoked tokens", async () => {
    assert((await read(a)).data.tasks.length > 0);
    assert.deepEqual((await read(b)).data.tasks, []);
    const loggedOut = await request("/auth/v1/logout?scope=global", {
      token: b.token,
      method: "POST",
    });
    assert([200, 204].includes(loggedOut.status));
    assert([401, 403].includes((await rpc("dylan_read", b.token)).status));
  });
}
