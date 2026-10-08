# Version 1.5.2 staging setup and verification

The local app remains unchanged and uses localStorage. No real user data has been uploaded, no hosted project has been created here, and production is not activated. The only new package is `pg`, a development dependency for real database tests. SQL migrations and optional staging client are not imported by the frontend bundle.

## Local repeatable security tests

Requirements: Node 24, `npm ci`, Docker, and access to the pinned PostgreSQL/PostgREST images. Run from the checkout:

```sh
./scripts/db-local.sh start
npm run test:db
./scripts/local-api.sh start
npm run test:api
./scripts/local-api.sh stop
./scripts/db-local.sh stop
```

Run `test:db` before starting PostgREST. To repeat SQL tests, stop the test API first; the runner resets only the explicitly disposable local database on port 55432. It refuses remote URLs and other ports. Fixtures and passwords are synthetic, published test values, with database/API ports bound to loopback. Never reuse those credentials outside these disposable containers. The Docker network is private to these test services. The tests clean up their synthetic API accounts and close connections.

SQL tests apply all migrations from scratch, impersonate anonymous/authenticated roles using synthetic verified-claim fixtures, and exercise actual PostgreSQL RLS, FK constraints, snapshots, transaction rollback, revocation and revision races. A minimal Storage schema fixture tests the real restrictive policy against an intentionally permissive policy. HTTP tests use actual PostgREST cryptographic JWT verification plus actual database policies. Synthetic JWTs are signed by the test harness, **not issued by GoTrue**. These tests do not verify Supabase hosted Auth, gateway, email setup or Storage HTTP behavior.

`npm test` runs application/unit tests, including session-cache/pending-request races. These use mocked HTTP only for client lifecycle behavior and are **not** RLS evidence. Run `npm run build` and the existing `scripts/browser-smoke.cjs` against production preview for desktop/mobile regressions.

## Your hosted Supabase setup actions

1. Create a **new, isolated Supabase staging project** with a name such as `dylan-os-staging`. Do not reuse any production or personal-data project. Choose an appropriate region and a strong database password. Keep staging and future production project refs, keys, CI environments, domains and databases separate.
2. In Authentication settings, disable public email signups, anonymous sign-in, phone/SMS signup and unused providers. Enable email/password login only for administrator-created synthetic users. Use a short token lifetime (the local config specifies 15 minutes). Do not expose a public signup flow. Restrict redirect URLs to the intended staging origin and use no wildcard production redirects. The checked-in `config.toml` configures local Supabase; **it does not automatically configure hosted Dashboard settings**.
3. Install the official Supabase CLI on your Mac using the supported installer (for example `brew install supabase/tap/supabase`). From this repository, run `supabase link --project-ref YOUR_STAGING_REF`, inspect the selected project carefully, and run `supabase db push --dry-run` followed by `supabase db push`. Use the CLI's secure credential prompts/environment settings; never put secrets in files, shell history or chat. Apply migrations in filename order. Each is transactional; the CLI records applied versions so repeated pushes do not duplicate schema objects. Migrations are staging-only and must not be included in a production deployment job.
4. Audit the resulting 15 private tables, forced RLS, SELECT-only owner policies, composite foreign keys, restricted helpers and authenticated-only RPC grants. The `dylan-staging-private` bucket is private and intentionally unavailable to browser roles. Verify no other public buckets or permissive policies exist in the fresh staging project. No file feature needs enabling.
5. Configure the following **server/operator environment variables securely** to run the hosted test suite. None has a `VITE_` prefix. Do not commit `.env` files or disclose values in chat:

| Name                            | Purpose                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DYLAN_STAGING_URL`             | `https://YOUR_STAGING_REF.supabase.co`                                                                                |
| `DYLAN_STAGING_PROJECT_REF`     | Exact staging project reference                                                                                       |
| `DYLAN_STAGING_PUBLISHABLE_KEY` | Project publishable key (or legacy anon key)                                                                          |
| `DYLAN_STAGING_SECRET_KEY`      | Server-only secret/service-role key, used exclusively to provision/delete synthetic Auth users                        |
| `DYLAN_STAGING_DB_URL`          | TLS PostgreSQL administrator connection to the same staging project; transaction pooling may need compatible settings |
| `DYLAN_STAGING_TEST_APPROVED`   | Set to `1` only after verifying this is the synthetic staging project                                                 |

The runner validates the API/project/DB host pairing, checks that public signups are disabled, creates unique `example.invalid` synthetic accounts through the real Auth Admin API, allowlists them through SQL, and logs in through real Auth. It runs direct API/SQL-policy isolation, ownership-spoofing, export/snapshot/restore, conflict races, Storage API and account/logout tests, then deletes the test users. Use a direct or session-pooler connection and retain TLS certificate verification; supply the provider certificate through your normal trusted configuration if required. Prefer short-lived, tightly scoped CI secrets. A raw TCP database connection cannot use an HTTPS-only proxy-secret placeholder.

```sh
npm run test:staging
```

Without required configuration this reports **one skipped, zero passed hosted tests**. It must never be reported as a hosted security pass. If a hosted test fails, treat staging as unverified and fix the deployment/configuration before proceeding. The test runner may need network access to the exact staging API and database/pooler host. The current environment has no such credentials.

Administrator-created accounts must also have `dylan_staging_accounts.enabled=true` and `synthetic_only=true`. Auth metadata, JWT user metadata, client owner fields and subscription flags cannot enable account access. The hosted test runner creates and removes those synthetic accounts automatically. No service-role key belongs in a browser or app build. Secrets are used only for setup/test administration; ordinary commands use the signed-in user's bearer token.

## Rollback and recovery

- A failed migration rolls back its own transaction. Do not rerun an already recorded migration manually; use CLI history and a corrective forward migration. Test a fresh reset plus repeat push in local Supabase before applying corrective migrations to hosted staging.
- To disable staging access after deployment, apply `supabase/rollback/disable_cloud.sql` as an administrator. It disables the allowlist and revokes RPC/helper grants without dropping tables, relationships, snapshots or protective storage policy. The local application continues working independently.
- To re-enable, first fix and rerun security checks in an isolated project, then explicitly restore the documented authenticated grants and enable only selected synthetic accounts. Never broadly grant table writes. No automatic rollback script re-enables access.
- For a fresh staging teardown, delete the dedicated project only after verifying its reference and that it contains synthetic data exclusively. Production and browser localStorage are outside the teardown. Hosted provider backup restoration/retention and disaster recovery are not verified by these local tests.
- If cleanup fails, remove only the generated `dylan-synthetic-*` test users and associated allowlist rows. Do not clear an entire hosted project or reset unrelated records.

## Version 1.5.3 gate and exact recommended scope

**Do not begin without approval.** First complete real hosted Auth/API/RLS/Storage/session checks and a staging rollback drill. Then implement an explicitly opt-in local-to-account migration workflow for a controlled 18+ beta: verified external backup, sign-in without upload, source/destination preview, strong upload/replacement confirmation, server-side whole-workspace validation, atomic normalized import, round-trip IDs/counts/history/preferences/extensions comparison, preserved original local copy and rollback, account-scoped recovery/export, draft handling on offline/expiry/conflict, and logout/account-switch isolation.

This staging release deliberately has no bulk workspace upload, real-data migration or account UI. Add those only in the approved next milestone. Keep billing, paid AI, integrations, public launch, collaborative sharing and visual redesign outside 1.5.3. Production activation remains a separate approval gate after hosted tests, operational retention/deletion policy and real-data migration review.

## Validation recorded for this release

- **173 application/unit tests passed** after a clean `npm ci`; the production TypeScript/Vite build passed. The UI bundle is identical to the previous local release and contains no staging client or credentials.
- **18 real PostgreSQL tests passed** against a disposable PostgreSQL 17 container, including actual RLS, cross-owner FKs, snapshot/restore/rotation, concurrent conflict/rollback, session expiry/bans/revocation, restrictive Storage policy and the operational disable/re-enable drill. Migration application was repeated from a fresh disposable database.
- **7 real PostgREST HTTP tests passed**, including cryptographic JWT tampering/expiry checks, RLS visibility, direct-write/ownership denial, foreign links/restores, simultaneous revision conflicts, account switching, revocation and no-store RPC responses. Auth identities here are synthetic claim/session fixtures, not GoTrue-issued sessions.
- Existing desktop/mobile Chromium regressions passed for planning, quick add, personalization, real browser-tab conflicts, legacy identity migration, export/import/restore, Undo and quota safeguards.
- **Hosted Supabase: zero passed, one skipped**. Project credentials were absent. Hosted migrations, actual Supabase Auth/GoTrue, Dashboard email/signup/session settings, Storage HTTP behavior and provider backup recovery remain unverified. The CLI could not initialize in this environment due to its home-directory/download restrictions; local SQL/HTTP services were run directly instead. No hosted cloud security pass is claimed.
- Environment install/start instructions were saved as a draft for future local app and synthetic backend work. Saving does not publish or create a Supabase project; review/save/publish in environment settings if retaining those changes.
