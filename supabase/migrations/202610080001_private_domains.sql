-- 1.5.2: staging only. Execute transactionally; never apply to production.
begin;
do $$ begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Migrations require the trusted staging PostgreSQL administrator'; end if;
end $$;
create schema if not exists dylan_private;
revoke all on schema dylan_private from public, anon, authenticated;
alter default privileges in schema dylan_private revoke execute on functions from public;
create table public.dylan_staging_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 synthetic_only boolean not null default true check (synthetic_only),
 created_at timestamptz not null default now()
);
-- Provisioned manually by staging administrator; never through sign-up metadata.
create function dylan_private.actor() returns uuid language plpgsql stable security definer
set search_path = pg_catalog as $$
declare who uuid := auth.uid(); sid uuid;
begin
 if who is null or not exists(select 1 from public.dylan_staging_accounts where user_id=who and enabled and synthetic_only) then
  raise exception 'Staging account is not authorized' using errcode='42501';
 end if;
 sid := nullif(auth.jwt()->>'session_id','')::uuid;
 if sid is null or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=sid and s.user_id=who and (s.not_after is null or s.not_after>now()) and (u.banned_until is null or u.banned_until<=now())) then
  raise exception 'Session is no longer active' using errcode='42501';
 end if;
 return who;
end $$;
create table public.account_workspaces (
 user_id uuid primary key references public.dylan_staging_accounts(user_id) on delete cascade,
 revision bigint not null default 0 check (revision >= 0),
 schema_version integer not null default 6 check (schema_version=6),
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 updated_at timestamptz not null default now()
);
create table public.workspace_preferences (
 user_id uuid primary key references public.account_workspaces(user_id) on delete cascade,
 preferences jsonb not null default '{}' check(jsonb_typeof(preferences)='object'),
 revision bigint not null default 1 check(revision>0)
);
create table public.fitness_goals (
 user_id uuid primary key references public.account_workspaces(user_id) on delete cascade,
 goal_weight numeric check(goal_weight >= 1 and goal_weight <= 1500),
 calories numeric check(calories between 1 and 20000 and calories=trunc(calories)), protein numeric check(protein between 1 and 2000),
 steps integer check(steps between 1 and 100000), weekly_workouts integer check(weekly_workouts between 1 and 21),
 extras jsonb not null default '{}' check(jsonb_typeof(extras)='object'),
 present_fields text[] not null default '{}', revision bigint not null default 1 check(revision>0)
);
create table public.tasks (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "name" text not null check (length(trim(name)) > 0),
 "category" text not null,
 "priority" text not null check (priority in ('High','Medium','Low')),
 "due" date not null,
 "completed" boolean not null,
 "recurring" boolean not null,
 "completedOn" date,
 primary key(user_id,id)
);
create table public.courses (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "name" text not null check (length(trim(name)) > 0),
 "code" text not null,
 "instructor" text not null,
 "grade" numeric check (grade between 0 and 100),
 "notes" text not null,
 primary key(user_id,id)
);
create table public.school_work (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "name" text not null check (length(trim(name)) > 0),
 "courseId" text not null,
 "due" date not null,
 "type" text not null check (type in ('Assignment','Exam')),
 "completed" boolean not null,
 "completedOn" date,
 "grade" numeric check (grade between 0 and 100),
 "notes" text,
 primary key(user_id,id),
 foreign key(user_id,"courseId") references public.courses(user_id,id) on delete cascade
);
create table public.weight_entries (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "date" date not null,
 "value" numeric not null check (value >= 1 and value <= 1500),
 primary key(user_id,id),
 unique(user_id,date)
);
create table public.daily_nutrition (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "date" date not null,
 "calories" numeric not null check (calories between 0 and 20000),
 "protein" numeric not null check (protein between 0 and 2000),
 "steps" integer not null check (steps between 0 and 200000),
 primary key(user_id,id),
 unique(user_id,date)
);
create table public.workout_entries (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "date" date not null,
 "name" text not null check (length(trim(name)) > 0),
 "exercise" text not null check (length(trim(exercise)) > 0),
 "weight" numeric not null check (weight between 0 and 5000),
 "reps" integer not null check (reps between 1 and 1000),
 "sets" integer check (sets between 1 and 100),
 "completed" boolean not null,
 primary key(user_id,id)
);
create table public.habits (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "name" text not null check (length(trim(name)) > 0),
 "dates" date[] not null check (cardinality(dates) <= 10000),
 "createdOn" date,
 "target" integer check (target between 1 and 100),
 "schedule" integer[] check (schedule <@ array[0,1,2,3,4,5,6] and cardinality(schedule) > 0),
 "counts" jsonb check (counts is null or jsonb_typeof(counts)='object'),
 "scheduleHistory" jsonb check ("scheduleHistory" is null or jsonb_typeof("scheduleHistory")='array'),
 primary key(user_id,id)
);
create table public.important_dates (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "name" text not null check (length(trim(name)) > 0),
 "date" date not null,
 primary key(user_id,id)
);
create table public.commitment_series (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "name" text not null check (length(trim(name)) > 0),
 "kind" text not null check (kind in ('Class','Work','Personal')),
 "days" integer[] not null check (days <@ array[0,1,2,3,4,5,6] and cardinality(days) between 1 and 7),
 "startTime" text not null check ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 "endTime" text not null check ("endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 "startsOn" date not null,
 "endsOn" date,
 "exceptions" date[] not null,
 primary key(user_id,id),
 check("startTime" < "endTime"), check("endsOn" is null or "endsOn" >= "startsOn")
);
create table public.weekly_reflections (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id text not null check(length(trim(id)) between 1 and 200),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz, updated_at timestamptz,
 extensions jsonb not null default '{}' check(jsonb_typeof(extensions)='object'),
 present_fields text[] not null,
 "weekStart" date not null check (extract(isodow from "weekStart") = 1),
 "reflection" text not null,
 "priorities" text[] not null check (cardinality(priorities)=3),
 "savedAt" timestamptz not null,
 primary key(user_id,id),
 unique(user_id,"weekStart")
);
create table public.workspace_snapshots (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id uuid not null default gen_random_uuid(), revision bigint not null, schema_version integer not null check(schema_version=6),
 payload jsonb not null check(jsonb_typeof(payload)='object'), reason text not null,
 created_at timestamptz not null default now(), primary key(user_id,id)
);
-- All private tables default deny. Browser roles can only SELECT their own approved account's rows.
alter table public.dylan_staging_accounts enable row level security;
alter table public.dylan_staging_accounts force row level security;
revoke all on public.dylan_staging_accounts from public, anon, authenticated;
grant select on public.dylan_staging_accounts to authenticated;
create policy own_read on public.dylan_staging_accounts for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.account_workspaces enable row level security;
alter table public.account_workspaces force row level security;
revoke all on public.account_workspaces from public, anon, authenticated;
grant select on public.account_workspaces to authenticated;
create policy own_read on public.account_workspaces for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.workspace_preferences enable row level security;
alter table public.workspace_preferences force row level security;
revoke all on public.workspace_preferences from public, anon, authenticated;
grant select on public.workspace_preferences to authenticated;
create policy own_read on public.workspace_preferences for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.fitness_goals enable row level security;
alter table public.fitness_goals force row level security;
revoke all on public.fitness_goals from public, anon, authenticated;
grant select on public.fitness_goals to authenticated;
create policy own_read on public.fitness_goals for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
revoke all on public.tasks from public, anon, authenticated;
grant select on public.tasks to authenticated;
create policy own_read on public.tasks for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.courses enable row level security;
alter table public.courses force row level security;
revoke all on public.courses from public, anon, authenticated;
grant select on public.courses to authenticated;
create policy own_read on public.courses for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.school_work enable row level security;
alter table public.school_work force row level security;
revoke all on public.school_work from public, anon, authenticated;
grant select on public.school_work to authenticated;
create policy own_read on public.school_work for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.weight_entries enable row level security;
alter table public.weight_entries force row level security;
revoke all on public.weight_entries from public, anon, authenticated;
grant select on public.weight_entries to authenticated;
create policy own_read on public.weight_entries for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.daily_nutrition enable row level security;
alter table public.daily_nutrition force row level security;
revoke all on public.daily_nutrition from public, anon, authenticated;
grant select on public.daily_nutrition to authenticated;
create policy own_read on public.daily_nutrition for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.workout_entries enable row level security;
alter table public.workout_entries force row level security;
revoke all on public.workout_entries from public, anon, authenticated;
grant select on public.workout_entries to authenticated;
create policy own_read on public.workout_entries for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.habits enable row level security;
alter table public.habits force row level security;
revoke all on public.habits from public, anon, authenticated;
grant select on public.habits to authenticated;
create policy own_read on public.habits for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.important_dates enable row level security;
alter table public.important_dates force row level security;
revoke all on public.important_dates from public, anon, authenticated;
grant select on public.important_dates to authenticated;
create policy own_read on public.important_dates for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.commitment_series enable row level security;
alter table public.commitment_series force row level security;
revoke all on public.commitment_series from public, anon, authenticated;
grant select on public.commitment_series to authenticated;
create policy own_read on public.commitment_series for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.weekly_reflections enable row level security;
alter table public.weekly_reflections force row level security;
revoke all on public.weekly_reflections from public, anon, authenticated;
grant select on public.weekly_reflections to authenticated;
create policy own_read on public.weekly_reflections for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
alter table public.workspace_snapshots enable row level security;
alter table public.workspace_snapshots force row level security;
revoke all on public.workspace_snapshots from public, anon, authenticated;
grant select on public.workspace_snapshots to authenticated;
create policy own_read on public.workspace_snapshots for select to authenticated using (user_id=auth.uid() and user_id=dylan_private.actor());
grant usage on schema dylan_private to authenticated;
grant execute on function dylan_private.actor() to authenticated;
-- No storage bucket is created or granted by this release. Local client has no storage API.
commit;
