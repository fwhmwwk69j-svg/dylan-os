-- Operational disable: preserve data on both original and Phase 2A staging schemas.
begin;
update public.dylan_staging_accounts set enabled=false;
revoke all on function public.dylan_read(),public.dylan_export(),public.dylan_command(jsonb) from authenticated,anon,public;
do $$ begin
 if to_regprocedure('public.dylan_execute_operation(jsonb)') is not null then
  execute 'revoke all on function public.dylan_execute_operation(jsonb) from authenticated,anon,public';
 end if;
 if to_regprocedure('public.dylan_operation_status(uuid)') is not null then
  execute 'revoke all on function public.dylan_operation_status(uuid) from authenticated,anon,public';
 end if;
end $$;
revoke execute on function dylan_private.actor() from authenticated,anon,public;
-- Keep forced RLS, FK constraints, snapshots, receipts, ordering and storage protection.
-- Re-enabling requires explicit administrator action after fixing and retesting.
commit;
