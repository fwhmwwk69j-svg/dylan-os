-- Operational rollback for staging only: disable access without deleting synthetic records.
begin;
update public.dylan_staging_accounts set enabled=false;
revoke all on function public.dylan_read(),public.dylan_export(),public.dylan_command(jsonb) from authenticated,anon,public;
revoke execute on function dylan_private.actor() from authenticated,anon,public;
-- Keep forced RLS, FK constraints, snapshots and restrictive storage guard intact.
-- Re-enabling is an explicit administrator action after fixing and retesting staging.
commit;
