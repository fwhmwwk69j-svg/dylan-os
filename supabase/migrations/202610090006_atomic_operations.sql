-- Phase 2A: versioned operations. Existing RPC signatures and local storage are unchanged.
begin;
create function dylan_private.normalize_positions(who uuid) returns void
language plpgsql set search_path=pg_catalog as $$
declare kind text; tab text;
begin
 for kind in select unnest(array['tasks','courses','assignments','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
  tab := dylan_private.model(kind)->>'table';
  execute format('with ranked as (select id,row_number() over(order by position,id)-1 pos from public.%1$I where user_id=$1) update public.%1$I r set position=ranked.pos from ranked where r.user_id=$1 and r.id=ranked.id and r.position<>ranked.pos',tab) using who;
 end loop;
end $$;
create function dylan_private.deleted_record(who uuid,kind text,record_id text) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare item jsonb; tab text := dylan_private.model(kind)->>'table';
begin
 execute format('select jsonb_build_object(''record'',r.extensions || (select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(to_jsonb(r)) where key=any(r.present_fields)),''position'',r.position) from public.%I r where user_id=$1 and id=$2',tab) into item using who,record_id;
 return item;
end $$;
create function dylan_private.check_mutation(who uuid,mutation jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare kind text := mutation->>'collection'; tab text; record_id text; actual bigint; linked jsonb;
begin
 if jsonb_typeof(mutation) is distinct from 'object' or mutation->>'action' not in ('upsert','delete') or mutation->>'action' is null
  or mutation ?| array['user_id','userId','owner','entitlements','permissions'] then raise exception 'Invalid mutation' using errcode='22023'; end if;
 tab := dylan_private.model(kind)->>'table';
 if jsonb_typeof(mutation->'expectedRecordRevision') is distinct from 'number' or (mutation->>'expectedRecordRevision') !~ '^\d+$' or (mutation->>'expectedRecordRevision')::numeric>9007199254740991 then raise exception 'Invalid record revision' using errcode='22023'; end if;
 if mutation->>'action'='upsert' then
  perform dylan_private.validate_record(kind,mutation->'record'); record_id := mutation->'record'->>'id';
 else
  if jsonb_typeof(mutation->'id') is distinct from 'string' or length(trim(mutation->>'id')) not between 1 and 200 then raise exception 'Invalid deletion ID' using errcode='22023'; end if;
  record_id := mutation->>'id';
 end if;
 execute format('select revision from public.%I where user_id=$1 and id=$2',tab) into actual using who,record_id;
 if coalesce(actual,0)<>(mutation->>'expectedRecordRevision')::bigint or (mutation->>'action'='delete' and actual is null) then raise exception 'Record revision conflict' using errcode='PT409'; end if;
 if kind='courses' and mutation->>'action'='delete' then
  select coalesce(jsonb_object_agg(id,revision),'{}') into linked from public.school_work where user_id=who and "courseId"=record_id;
  if jsonb_typeof(mutation->'expectedLinkedRevisions') is distinct from 'object' then raise exception 'Linked revision inventory required' using errcode='22023'; end if;
  if linked<>mutation->'expectedLinkedRevisions' then raise exception 'Linked record revision conflict' using errcode='PT409'; end if;
 end if;
end $$;
create function dylan_private.reorder(who uuid,kind text,ids jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare tab text := dylan_private.model(kind)->>'table'; existing jsonb;
begin
 if jsonb_typeof(ids) is distinct from 'array' or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string') then raise exception 'Invalid collection order' using errcode='22023'; end if;
 if jsonb_array_length(ids)<>(select count(distinct x) from jsonb_array_elements_text(ids) x) then raise exception 'Duplicate order IDs' using errcode='22023'; end if;
 execute format('select coalesce(jsonb_agg(id order by id),''[]'') from public.%I where user_id=$1',tab) into existing using who;
 if existing<>(select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements_text(ids) x) then raise exception 'Order membership conflict' using errcode='PT409'; end if;
 execute format('update public.%I r set position=v.ordinality-1 from jsonb_array_elements_text($2) with ordinality v(id,ordinality) where r.user_id=$1 and r.id=v.id',tab) using who,ids;
end $$;
create function dylan_private.undo_deletion(who uuid,deletion_id uuid,next_revision bigint) returns void
language plpgsql set search_path=pg_catalog as $$
declare saved record; kind text; item jsonb; tab text; ids jsonb; target integer; record_id text;
begin
 select * into saved from public.workspace_deletion_receipts where user_id=who and id=deletion_id for update;
 if not found then raise exception 'Deletion unavailable' using errcode='42501'; end if;
 if saved.consumed_at is not null or saved.expires_at<=clock_timestamp() then raise exception 'Undo expired or consumed' using errcode='PT409'; end if;
 -- Parent courses precede linked school work. Restore only recorded deleted rows.
 for kind in select unnest(array['courses','tasks','assignments','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
  tab := dylan_private.model(kind)->>'table';
  for item in select value from jsonb_array_elements(coalesce(saved.payload->kind,'[]')) order by (value->>'position')::bigint loop
   record_id := item->'record'->>'id';
   perform dylan_private.write_record(who,kind,item->'record',0,next_revision);
   execute format('select coalesce(jsonb_agg(id order by position,id),''[]'') from public.%I where user_id=$1 and id<>$2',tab) into ids using who,record_id;
   target := least((item->>'position')::bigint,jsonb_array_length(ids))::integer;
   ids := (select coalesce(jsonb_agg(id order by rank),'[]') from (
    select value id,case when ordinality-1<target then ordinality-1 else ordinality end rank from jsonb_array_elements(ids) with ordinality
    union all select to_jsonb(record_id),target) ordered);
   perform dylan_private.reorder(who,kind,ids);
  end loop;
 end loop;
 update public.workspace_deletion_receipts set consumed_at=clock_timestamp() where user_id=who and id=deletion_id;
end $$;

create function public.dylan_execute_operation(request jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
<<execution>>
declare who uuid := dylan_private.actor(); operation jsonb; action text; operation_id uuid; issued timestamptz; fingerprint text;
 existing public.workspace_operation_receipts%rowtype; current_revision bigint; expected bigint; mutations jsonb; mutation jsonb; kind text; tab text; record_id text;
 deleted jsonb := '{}'; linked jsonb; deletion_id uuid; receipt jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 if jsonb_typeof(request) is distinct from 'object' or octet_length(request::text)>262144 or request->'version' is distinct from '1'::jsonb
  or request ?| array['user_id','userId','owner','workspace','entitlements','permissions']
  or jsonb_typeof(request->'operationId') is distinct from 'string'
  or jsonb_typeof(request->'expectedRevision') is distinct from 'number'
  or (request->>'expectedRevision') !~ '^\d+$' or (request->>'expectedRevision')::numeric>9007199254740991
  or jsonb_typeof(request->'operation') is distinct from 'object' then raise exception 'Invalid operation envelope' using errcode='22023'; end if;
 operation_id := (request->>'operationId')::uuid;
 issued := dylan_private.operation_time(operation_id);
 fingerprint := encode(sha256(convert_to(request::text,'UTF8')),'hex');
 expected := (request->>'expectedRevision')::bigint;
 operation := request->'operation'; action := operation->>'action';
 if operation ?| array['user_id','userId','owner','entitlements','permissions'] then raise exception 'Client authority forbidden' using errcode='22023'; end if;
 insert into public.account_workspaces(user_id) values(who) on conflict do nothing;
 select revision into current_revision from public.account_workspaces where user_id=who for update;
 select * into existing from public.workspace_operation_receipts r where r.user_id=who and r.operation_id=execution.operation_id;
 if found then
  if existing.request_fingerprint<>fingerprint then raise exception 'Operation ID payload conflict' using errcode='PT409'; end if;
  return jsonb_build_object('receipt',dylan_private.operation_receipt(who,operation_id),'workspace',public.dylan_read(),'replayed',true);
 end if;
 if issued<clock_timestamp()-interval '24 hours' or issued>clock_timestamp()+interval '5 minutes' then raise exception 'Operation ID outside admission window' using errcode='22023'; end if;
 if current_revision<>expected then raise exception 'Workspace revision conflict' using errcode='PT409'; end if;
 if current_revision>=9007199254740991 then raise exception 'Workspace revision exhausted' using errcode='22023'; end if;
 if action='batch' then
  mutations := operation->'mutations';
  if jsonb_typeof(mutations) is distinct from 'array' or jsonb_array_length(mutations) not between 1 and 100 then raise exception 'Batch requires 1 to 100 mutations' using errcode='22023'; end if;
 elsif action in ('upsert','delete') then mutations := jsonb_build_array(operation);
 elsif action not in ('preferences','goals','reorder','undo') or action is null then raise exception 'Unsupported operation' using errcode='22023';
 end if;
 if mutations is not null then
  for mutation in select value from jsonb_array_elements(mutations) loop perform dylan_private.check_mutation(who,mutation); end loop;
  if (select count(*) from jsonb_array_elements(mutations))<>(select count(distinct jsonb_build_array(value->>'collection',coalesce(value->'record'->>'id',value->>'id'))) from jsonb_array_elements(mutations)) then raise exception 'Duplicate mutation target' using errcode='22023'; end if;
  -- Reject overlapping explicit child edits/deletes and implicit course cascade effects.
  if exists(select 1 from jsonb_array_elements(mutations) parent join public.school_work child on child.user_id=who and child."courseId"=parent->>'id'
   join jsonb_array_elements(mutations) explicit on explicit->>'collection'='assignments' and coalesce(explicit->'record'->>'id',explicit->>'id')=child.id
   where parent->>'action'='delete' and parent->>'collection'='courses') then raise exception 'Overlapping course cascade mutation' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(mutations) parent cross join jsonb_array_elements(mutations) child
   where parent->>'action'='delete' and parent->>'collection'='courses' and child->>'action'='upsert'
   and child->>'collection'='assignments' and child->'record'->>'courseId'=parent->>'id') then raise exception 'Overlapping course cascade mutation' using errcode='22023'; end if;
 end if;
 perform dylan_private.save_snapshot(who,current_revision,'Before '||action||' operation');
 if mutations is not null then
  -- Parent creates/edits first, then dependent creates/edits, then deletions.
  for mutation in select value from jsonb_array_elements(mutations) with ordinality order by case when value->>'action'='delete' then 2 when value->>'collection'='courses' then 0 else 1 end,ordinality loop
   kind := mutation->>'collection'; tab := dylan_private.model(kind)->>'table';
   if mutation->>'action'='upsert' then
    perform dylan_private.write_record(who,kind,mutation->'record',(mutation->>'expectedRecordRevision')::bigint,current_revision+1);
   else
    record_id := mutation->>'id';
    if action='delete' then
     deleted := jsonb_build_object(kind,jsonb_build_array(dylan_private.deleted_record(who,kind,record_id)));
     if kind='courses' then
      select coalesce(jsonb_agg(dylan_private.deleted_record(who,'assignments',id) order by position,id),'[]') into linked from public.school_work where user_id=who and "courseId"=record_id;
      deleted := deleted || jsonb_build_object('assignments',linked);
     end if;
    end if;
    execute format('delete from public.%I where user_id=$1 and id=$2',tab) using who,record_id;
   end if;
  end loop;
  if action='delete' then
   insert into public.workspace_deletion_receipts(user_id,payload) values(who,deleted) returning id into deletion_id;
  end if;
 elsif action='preferences' then perform dylan_private.set_preferences(who,operation->'preferences',current_revision+1);
 elsif action='goals' then perform dylan_private.set_goals(who,operation->'goals',current_revision+1);
 elsif action='reorder' then perform dylan_private.reorder(who,operation->>'collection',operation->'ids');
 elsif action='undo' then perform dylan_private.undo_deletion(who,(operation->>'deletionId')::uuid,current_revision+1);
 end if;
 perform dylan_private.normalize_positions(who);
 if octet_length(dylan_private.export_state(who)::text)>5242880 then raise exception 'Workspace exceeds staging size limit' using errcode='22023'; end if;
 update public.account_workspaces set revision=current_revision+1,updated_at=now() where user_id=who;
 insert into public.workspace_operation_receipts(user_id,operation_id,request_fingerprint,committed_revision,operation_kind,deletion_id)
 values(who,operation_id,fingerprint,current_revision+1,action,deletion_id);
 receipt := dylan_private.operation_receipt(who,operation_id);
 return jsonb_build_object('receipt',receipt,'workspace',public.dylan_read(),'replayed',false);
end $$;
-- Keep the legacy command entrypoint and response intact; share locks, ordered writes and snapshots.
alter function public.dylan_command(jsonb) set schema dylan_private;
alter function dylan_private.dylan_command(jsonb) rename to legacy_command;
revoke all on function dylan_private.legacy_command(jsonb) from public,anon,authenticated;
create function public.dylan_command(command jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid := dylan_private.actor(); current_revision bigint;
begin
 select revision into current_revision from public.account_workspaces where user_id=who for update;
 if current_revision>=9007199254740991 then raise exception 'Workspace revision exhausted' using errcode='22023'; end if;
 perform dylan_private.legacy_command(command);
 perform dylan_private.normalize_positions(dylan_private.actor());
 return public.dylan_read();
end $$;
revoke all on function dylan_private.normalize_positions(uuid),dylan_private.deleted_record(uuid,text,text),dylan_private.check_mutation(uuid,jsonb),dylan_private.reorder(uuid,text,jsonb),dylan_private.undo_deletion(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.dylan_execute_operation(jsonb),public.dylan_command(jsonb) from public,anon,authenticated;
grant execute on function public.dylan_execute_operation(jsonb),public.dylan_command(jsonb) to authenticated;
commit;
