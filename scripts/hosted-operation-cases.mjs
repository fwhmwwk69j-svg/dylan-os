import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  envelope,
  operationId,
  mutation,
  syntheticTask,
  domainRecords,
} from "./operation-fixtures.mjs";
/** Shared API cases: hosted uses real Auth; local uses signed synthetic identities. No resets/DDL/maintenance calls. */
export function operationCases({
  test,
  before,
  provision,
  rpc,
  request,
  db,
  revoke,
}) {
  let a, b;
  const execute = (u, req) =>
    rpc("dylan_execute_operation", u?.token, { request: req });
  const status = (u, id) =>
    rpc("dylan_operation_status", u?.token, { operation_id: id });
  const read = async (u) => {
    const r = await rpc("dylan_read", u.token);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return r.body;
  };
  const fresh = async (u, operation, id) =>
    execute(u, envelope((await read(u)).revision, operation, id));
  const accepted = async (result) => {
    const r = await result;
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return r.body;
  };
  const tables = {
    tasks: "tasks",
    courses: "courses",
    assignments: "school_work",
    weights: "weight_entries",
    nutrition: "daily_nutrition",
    workouts: "workout_entries",
    habits: "habits",
    dates: "important_dates",
    commitments: "commitment_series",
    weeklyReflections: "weekly_reflections",
  };
  async function checkpoint(u) {
    // Every payload query is scoped to a runner-created account.
    const queries = [
      "workspace_snapshots",
      "workspace_operation_receipts",
      "workspace_deletion_receipts",
    ];
    const result = { workspace: await read(u) };
    for (const table of queries)
      result[table] = (
        await db.query(
          `select to_jsonb(r) row from public.${table} r where user_id=$1 order by to_jsonb(r)::text`,
          [u.id],
        )
      ).rows;
    result.positions = (
      await db.query(
        Object.entries(tables)
          .map(
            ([kind, table]) =>
              `select '${kind}' collection,id,position from public.${table} where user_id=$1`,
          )
          .join(" union all ") + " order by collection,position,id",
        [u.id],
      )
    ).rows;
    return result;
  }
  before(async () => {
    a = await provision();
    b = await provision();
  });
  test("Phase 2A atomic batch seeds all ten collections and advances once", async () => {
    const current = await read(a);
    const rows = [
      ...domainRecords("z-hosted"),
      ...domainRecords("a-hosted").map(([kind, r]) => [
        kind,
        {
          ...r,
          ...(kind === "weights" || kind === "nutrition"
            ? { date: "2025-01-02" }
            : {}),
          ...(kind === "weeklyReflections" ? { weekStart: "2025-01-13" } : {}),
        },
      ]),
    ];
    const result = await accepted(
      execute(
        a,
        envelope(current.revision, {
          action: "batch",
          mutations: rows
            .slice()
            .reverse()
            .map(([kind, r]) => mutation(kind, r)),
        }),
      ),
    );
    assert.equal(result.workspace.revision, current.revision + 1);
    assert.equal(result.receipt.committedRevision, current.revision + 1);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.workspace_snapshots where user_id=$1",
          [a.id],
        )
      ).rows[0].n,
      1,
    );
    for (const [kind, r] of rows) {
      const actual = result.workspace.data[kind].find((v) => v.id === r.id);
      if (kind === "weeklyReflections") {
        assert.equal(Date.parse(actual.savedAt), Date.parse(r.savedAt));
        assert.deepEqual({ ...actual, savedAt: r.savedAt }, r);
      } else assert.deepEqual(actual, r);
      assert.equal(
        result.workspace.recordRevisions[kind][r.id],
        current.revision + 1,
      );
    }
  });
  test("Phase 2A rollback preserves records revisions positions snapshots and receipts", async () => {
    const initial = await checkpoint(a);
    const req = envelope(initial.workspace.revision, {
      action: "batch",
      mutations: [
        mutation("tasks", syntheticTask("rollback-first")),
        mutation("assignments", {
          id: "rollback-final",
          name: "Synthetic",
          courseId: "missing",
          due: "2026-10-09",
          type: "Exam",
          completed: false,
        }),
      ],
    });
    assert.equal((await execute(a, req)).status, 409);
    assert.deepEqual(await checkpoint(a), initial);
    assert.equal((await status(a, req.operationId)).body.status, "not-found");
    for (const bad of [
      envelope(
        initial.workspace.revision - 1,
        mutation("tasks", syntheticTask("stale")),
      ),
      envelope(
        initial.workspace.revision,
        mutation("tasks", initial.workspace.data.tasks[0], 999999),
      ),
    ]) {
      assert.equal((await execute(a, bad)).status, 409);
      assert.deepEqual(await checkpoint(a), initial);
    }
    for (const operation of [
      { action: "batch", mutations: [] },
      {
        action: "batch",
        mutations: Array.from({ length: 101 }, (_, i) =>
          mutation("tasks", syntheticTask("limit" + i)),
        ),
      },
      {
        action: "batch",
        mutations: [
          mutation("tasks", syntheticTask("duplicate")),
          mutation("tasks", syntheticTask("duplicate")),
        ],
      },
    ]) {
      assert.equal((await fresh(a, operation)).status, 400);
      assert.deepEqual(await checkpoint(a), initial);
    }
  });
  test("Phase 2A ordering and legacy restore preserve all ten collection arrays", async () => {
    let current = await read(a);
    for (const kind of Object.keys(tables)) {
      const ids = current.data[kind].map((v) => v.id).reverse();
      assert(ids.length >= 2);
      const r = await accepted(
        fresh(a, { action: "reorder", collection: kind, ids }),
      );
      assert.deepEqual(
        r.workspace.data[kind].map((v) => v.id),
        ids,
      );
      assert.deepEqual(r.workspace.recordRevisions, current.recordRevisions);
      current = r.workspace;
    }
    const row = current.data.tasks[0],
      order = current.data.tasks.map((r) => r.id);
    const edited = await accepted(
      fresh(
        a,
        mutation(
          "tasks",
          { ...row, name: "Synthetic edited" },
          current.recordRevisions.tasks[row.id],
        ),
      ),
    );
    assert.deepEqual(
      edited.workspace.data.tasks.map((r) => r.id),
      order,
    );
    const appended = await accepted(
      fresh(a, mutation("tasks", syntheticTask("append"))),
    );
    assert.deepEqual(
      appended.workspace.data.tasks.map((r) => r.id),
      [...order, "append"],
    );
    const snapshots = await request(
      "/rest/v1/workspace_snapshots?order=created_at.desc,id.desc",
      { token: a.token },
    );
    assert.equal(snapshots.status, 200);
    const snap = snapshots.body[0];
    const restored = await accepted(
      rpc("dylan_command", a.token, {
        command: {
          action: "restore",
          snapshotId: snap.id,
          confirmation: "RESTORE MY STAGING SNAPSHOT",
          expectedRevision: appended.workspace.revision,
        },
      }),
    );
    assert.deepEqual(restored.data, snap.payload);
    const beforeState = await checkpoint(a);
    assert.equal(
      (
        await fresh(a, {
          action: "reorder",
          collection: "tasks",
          ids: ["foreign"],
        })
      ).status,
      409,
    );
    assert.deepEqual(await checkpoint(a), beforeState);
  });
  test("Phase 2A UUIDv7 retries status and cross-account keys remain safe", async () => {
    const req = envelope(
      (await read(a)).revision,
      mutation("tasks", syntheticTask("idempotent")),
    );
    const first = await accepted(execute(a, req)),
      saved = await checkpoint(a);
    const replay = await accepted(execute(a, req));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.receipt, first.receipt);
    assert.deepEqual(await checkpoint(a), saved);
    assert.equal(
      (
        await execute(a, {
          ...req,
          operation: mutation("tasks", syntheticTask("changed")),
        })
      ).status,
      409,
    );
    assert.equal((await status(a, req.operationId)).body.status, "committed");
    assert.equal((await status(b, req.operationId)).body.status, "not-found");
    const other = await accepted(
      fresh(
        b,
        mutation("tasks", syntheticTask("b-idempotent")),
        req.operationId,
      ),
    );
    assert.equal(other.replayed, false);
    const later = await accepted(
      fresh(a, mutation("tasks", syntheticTask("intervening"))),
    );
    const lateReplay = await accepted(execute(a, req));
    assert.deepEqual(lateReplay.receipt, first.receipt);
    assert.equal(lateReplay.workspace.revision, later.workspace.revision);
    for (const id of [
      "00000000-0000-4000-8000-000000000000",
      operationId(Date.now() - 25 * 3600000),
      operationId(Date.now() + 6 * 60000),
    ])
      assert.equal(
        (await fresh(a, mutation("tasks", syntheticTask("expired")), id))
          .status,
        400,
      );
  });
  test("Phase 2A concurrent retries and legacy/new races have exactly one commit", async () => {
    let current = await read(a),
      req = envelope(
        current.revision,
        mutation("tasks", syntheticTask("concurrent-retry")),
      );
    const retries = await Promise.all([execute(a, req), execute(a, req)]);
    assert.deepEqual(
      retries.map((r) => r.status),
      [200, 200],
    );
    assert.deepEqual(retries.map((r) => r.body.replayed).sort(), [false, true]);
    assert.equal((await read(a)).revision, current.revision + 1);
    current = await read(a);
    const race = await Promise.all([
      execute(
        a,
        envelope(
          current.revision,
          mutation("tasks", syntheticTask("race-new")),
        ),
      ),
      rpc("dylan_command", a.token, {
        command: {
          action: "upsert",
          collection: "tasks",
          record: syntheticTask("race-legacy"),
          expectedRevision: current.revision,
          expectedRecordRevision: 0,
        },
      }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await read(a)).revision, current.revision + 1);
  });
  test("Phase 2A linked course delete and scoped Undo restore child order only", async () => {
    const current = await read(a),
      id = "z-hosted-course";
    const children = current.data.assignments.filter((r) => r.courseId === id),
      inventory = Object.fromEntries(
        children.map((r) => [r.id, current.recordRevisions.assignments[r.id]]),
      );
    const op = {
      action: "delete",
      collection: "courses",
      id,
      expectedRecordRevision: current.recordRevisions.courses[id],
      expectedLinkedRevisions: inventory,
    };
    const beforeState = await checkpoint(a);
    assert.equal(
      (await fresh(a, { ...op, expectedLinkedRevisions: {} })).status,
      409,
    );
    assert.deepEqual(await checkpoint(a), beforeState);
    const deleted = await accepted(fresh(a, op));
    assert(!deleted.workspace.data.courses.some((r) => r.id === id));
    assert(!deleted.workspace.data.assignments.some((r) => r.courseId === id));
    assert.equal(
      (
        await fresh(b, {
          action: "undo",
          deletionId: deleted.receipt.deletionId,
        })
      ).status,
      403,
    );
    await accepted(
      fresh(a, mutation("tasks", syntheticTask("unrelated-undo"))),
    );
    const req = envelope((await read(a)).revision, {
      action: "undo",
      deletionId: deleted.receipt.deletionId,
    });
    const undone = await accepted(execute(a, req));
    assert.deepEqual(undone.workspace.data.courses, current.data.courses);
    assert.deepEqual(
      undone.workspace.data.assignments,
      current.data.assignments,
    );
    assert(undone.workspace.data.tasks.some((r) => r.id === "unrelated-undo"));
    assert(
      undone.workspace.recordRevisions.courses[id] >
        current.recordRevisions.courses[id],
    );
    assert.equal((await execute(a, req)).body.replayed, true);
    assert.equal(
      (
        await fresh(a, {
          action: "undo",
          deletionId: deleted.receipt.deletionId,
        })
      ).status,
      409,
    );
  });
  test("Phase 2A Undo expires after the actual server 30-second window", async () => {
    const current = await read(a),
      row = current.data.tasks[0];
    const deleted = await accepted(
      fresh(a, {
        action: "delete",
        collection: "tasks",
        id: row.id,
        expectedRecordRevision: current.recordRevisions.tasks[row.id],
      }),
    );
    const receipt = (
      await db.query(
        "select extract(epoch from expires_at-created_at) seconds from public.workspace_deletion_receipts where user_id=$1 and id=$2",
        [a.id, deleted.receipt.deletionId],
      )
    ).rows[0];
    assert(Number(receipt.seconds) >= 30 && Number(receipt.seconds) < 31);
    await delay(31000);
    const initial = await checkpoint(a);
    assert.equal(
      (
        await fresh(a, {
          action: "undo",
          deletionId: deleted.receipt.deletionId,
        })
      ).status,
      409,
    );
    assert.deepEqual(await checkpoint(a), initial);
  });
  test("Phase 2A RLS and receipt/maintenance authorization deny browser access", async () => {
    const rows = (
      await db.query(
        "select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",
        [
          [
            ...Object.values(tables),
            "dylan_staging_accounts",
            "account_workspaces",
            "workspace_preferences",
            "fitness_goals",
            "workspace_snapshots",
            "workspace_operation_receipts",
            "workspace_deletion_receipts",
          ],
        ],
      )
    ).rows;
    assert.equal(rows.length, 17);
    for (const table of Object.values(tables)) {
      const foreign = await request(
        "/rest/v1/" + table + "?user_id=eq." + a.id,
        { token: b.token },
      );
      assert.equal(foreign.status, 200);
      assert.deepEqual(foreign.body, []);
    }

    for (const row of rows) {
      assert(row.relrowsecurity);
      assert(row.relforcerowsecurity);
    }
    for (const table of [
      "workspace_operation_receipts",
      "workspace_deletion_receipts",
    ])
      for (const token of [a.token, b.token, undefined])
        for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
          const r = await request("/rest/v1/" + table, {
            token,
            method,
            ...(method === "POST" || method === "PATCH"
              ? { body: { user_id: a.id } }
              : {}),
          });
          assert([401, 403].includes(r.status));
        }
    const grants = (
      await db.query(
        "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dylan_private' and (has_function_privilege('anon',p.oid,'EXECUTE') or (p.proname<>'actor' and has_function_privilege('authenticated',p.oid,'EXECUTE')))",
      )
    ).rows;
    assert.deepEqual(grants, []);
    assert(
      [401, 403].includes(
        (
          await execute(
            undefined,
            envelope(0, mutation("tasks", syntheticTask("anon"))),
          )
        ).status,
      ),
    );
    assert(
      [401, 403].includes((await status(undefined, operationId())).status),
    );
    const maintenance = await rpc("cleanup_operation_receipts", a.token);
    assert([403, 404].includes(maintenance.status));
    const beforeState = await checkpoint(b);
    const foreign = await fresh(
      b,
      mutation("assignments", {
        id: "foreign-link",
        name: "Synthetic",
        courseId: "a-hosted-course",
        due: "2026-10-09",
        type: "Exam",
        completed: false,
      }),
    );
    assert.equal(foreign.status, 409);
    assert.deepEqual(await checkpoint(b), beforeState);
    const spoof = envelope(
      (await read(b)).revision,
      mutation("tasks", syntheticTask("spoof")),
    );
    spoof.owner = a.id;
    assert.equal((await execute(b, spoof)).status, 400);
  });
  test("Phase 2A replay/status recheck allowlisting and live session expiry", async () => {
    const u = await provision(),
      req = envelope(0, mutation("tasks", syntheticTask("auth-replay")));
    await accepted(execute(u, req));
    try {
      await db.query(
        "update public.dylan_staging_accounts set enabled=false where user_id=$1",
        [u.id],
      );
      assert([401, 403].includes((await execute(u, req)).status));
      assert([401, 403].includes((await status(u, req.operationId)).status));
    } finally {
      await db.query(
        "update public.dylan_staging_accounts set enabled=true where user_id=$1",
        [u.id],
      );
    }
    const sid = JSON.parse(
      Buffer.from(u.token.split(".")[1], "base64url").toString(),
    ).session_id;
    const original = (
      await db.query(
        "select not_after from auth.sessions where id=$1 and user_id=$2",
        [sid, u.id],
      )
    ).rows[0];
    assert(original);
    try {
      await db.query(
        "update auth.sessions set not_after=now()-interval '1 minute' where id=$1 and user_id=$2",
        [sid, u.id],
      );
      assert([401, 403].includes((await execute(u, req)).status));
      assert([401, 403].includes((await status(u, req.operationId)).status));
    } finally {
      await db.query(
        "update auth.sessions set not_after=$1 where id=$2 and user_id=$3",
        [original.not_after, sid, u.id],
      );
    }
    assert.equal((await execute(u, req)).body.replayed, true);
  });
  test("Phase 2A synthetic expired receipt removal cannot allow old-ID execution", async () => {
    // Never invoke global cleanup: directly remove only a receipt owned by a fresh test account.
    const u = await provision(),
      id = operationId(Date.now() - 8 * 86400000);
    await db.query(
      "insert into public.account_workspaces(user_id) values($1)",
      [u.id],
    );
    await db.query(
      "insert into public.workspace_operation_receipts(user_id,operation_id,request_fingerprint,committed_revision,operation_kind,committed_at) values($1,$2,repeat('a',64),1,'upsert',now()-interval '8 days')",
      [u.id, id],
    );
    assert.equal((await status(u, id)).body.status, "committed");
    await db.query(
      "delete from public.workspace_operation_receipts where user_id=$1 and operation_id=$2",
      [u.id, id],
    );
    assert.equal((await status(u, id)).body.status, "expired");
    const initial = await checkpoint(u);
    assert.equal(
      (await fresh(u, mutation("tasks", syntheticTask("expired-removed")), id))
        .status,
      400,
    );
    assert.deepEqual(await checkpoint(u), initial);
  });
  test("Phase 2A unapproved accounts and revoked sessions cannot replay receipts", async () => {
    const u = await provision();
    await db.query(
      "delete from public.dylan_staging_accounts where user_id=$1",
      [u.id],
    );
    const req = envelope(0, mutation("tasks", syntheticTask("unapproved")));
    assert([401, 403].includes((await execute(u, req)).status));
    assert([401, 403].includes((await status(u, req.operationId)).status));
    const approved = await provision(),
      saved = envelope(0, mutation("tasks", syntheticTask("revoked")));
    await accepted(execute(approved, saved));
    await revoke(approved);
    assert([401, 403].includes((await execute(approved, saved)).status));
    assert(
      [401, 403].includes((await status(approved, saved.operationId)).status),
    );
  });
}
