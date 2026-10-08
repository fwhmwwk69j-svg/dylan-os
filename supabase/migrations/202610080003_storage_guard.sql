begin;
-- Quarantine bucket: deliberately no browser upload/read feature in 1.5.2.
-- Restrictive policy remains default-deny even if a permissive policy is added later.
do $$ begin
 if to_regclass('storage.objects') is not null then
  insert into storage.buckets(id,name,public,file_size_limit) values('dylan-staging-private','dylan-staging-private',false,5242880) on conflict(id) do update set public=false,file_size_limit=5242880;
  execute 'create policy dylan_staging_storage_guard on storage.objects as restrictive for all to anon,authenticated using (bucket_id <> ''dylan-staging-private'') with check (bucket_id <> ''dylan-staging-private'')';
 end if;
end $$;
commit;
