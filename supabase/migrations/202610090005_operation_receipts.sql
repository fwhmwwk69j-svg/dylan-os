-- Phase 2A: account-private receipts. No hosted maintenance job is installed.
begin;
create table public.workspace_operation_receipts (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 operation_id uuid not null,
 request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
 committed_revision bigint not null check(committed_revision>0),
 operation_kind text not null,
 deletion_id uuid,
 committed_at timestamptz not null default clock_timestamp(),
 primary key(user_id,operation_id)
);
create index workspace_operation_receipts_retention on public.workspace_operation_receipts(committed_at);
create table public.workspace_deletion_receipts (
 user_id uuid not null references public.account_workspaces(user_id) on delete cascade,
 id uuid not null default gen_random_uuid(),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=5242880),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '30 seconds',
 consumed_at timestamptz,
 primary key(user_id,id), check(expires_at>created_at)
);
create index workspace_deletion_receipts_retention on public.workspace_deletion_receipts(expires_at);
alter table public.workspace_operation_receipts enable row level security;
alter table public.workspace_operation_receipts force row level security;
alter table public.workspace_deletion_receipts enable row level security;
alter table public.workspace_deletion_receipts force row level security;
revoke all on public.workspace_operation_receipts,public.workspace_deletion_receipts from public,anon,authenticated;

create function dylan_private.operation_time(id uuid) returns timestamptz
language plpgsql immutable set search_path=pg_catalog as $$
declare value text := id::text; millis bigint;
begin
 if id is null or value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception 'UUIDv7 operation ID required' using errcode='22023';
 end if;
 millis := ('x'||replace(left(value,13),'-',''))::bit(48)::bigint;
 return to_timestamp(millis::double precision/1000);
end $$;
create function dylan_private.operation_receipt(who uuid,id uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('operationId',operation_id,'committedRevision',committed_revision,'kind',operation_kind,'deletionId',deletion_id,'committedAt',committed_at)
 from public.workspace_operation_receipts where user_id=who and operation_id=id
$$;
create function public.dylan_operation_status(operation_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid := dylan_private.actor(); receipt jsonb; issued timestamptz;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 issued := dylan_private.operation_time(operation_id);
 receipt := dylan_private.operation_receipt(who,operation_id);
 if receipt is not null then return jsonb_build_object('status','committed','receipt',receipt); end if;
 return jsonb_build_object('status',case when issued<statement_timestamp()-interval '24 hours' then 'expired' else 'not-found' end);
end $$;
-- Trusted administrator only; each invocation bounds work. Never grants browser maintenance.
create function dylan_private.cleanup_operation_receipts() returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare operations integer; deletions integer;
begin
 delete from public.workspace_operation_receipts where (user_id,operation_id) in
  (select user_id,operation_id from public.workspace_operation_receipts where committed_at<clock_timestamp()-interval '7 days' order by committed_at limit 1000);
 get diagnostics operations=row_count;
 delete from public.workspace_deletion_receipts where (user_id,id) in
  (select user_id,id from public.workspace_deletion_receipts where expires_at<clock_timestamp()-interval '5 minutes' order by expires_at limit 1000);
 get diagnostics deletions=row_count;
 return jsonb_build_object('operations',operations,'deletions',deletions);
end $$;
revoke all on function dylan_private.operation_time(uuid),dylan_private.operation_receipt(uuid,uuid),dylan_private.cleanup_operation_receipts() from public,anon,authenticated;
revoke all on function public.dylan_operation_status(uuid) from public,anon,authenticated;
grant execute on function public.dylan_operation_status(uuid) to authenticated;
commit;
