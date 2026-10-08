-- Disposable PostgreSQL test fixture only, not a Supabase migration.
-- Real hosted/local Supabase already owns these auth definitions.
create role anon nologin;
create role authenticated nologin;
create role authenticator login password 'synthetic-test-only' noinherit;
grant anon, authenticated to authenticator;
create schema auth;
create table auth.users(id uuid primary key,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema public,auth to anon,authenticated;
-- No grants on auth users/session tables; authorization helper alone reads them.

-- Minimal Storage policy fixture; it is not the real Supabase Storage HTTP service.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
alter table storage.objects enable row level security;
alter table storage.objects force row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
-- Deliberately permissive: migration's restrictive quarantine guard must still win.
create policy test_permissive on storage.objects for all to anon,authenticated using(true) with check(true);
