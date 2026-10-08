begin;
create function dylan_private.model(kind text) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare model jsonb;
begin model := '{"tasks": {"table": "tasks", "fields": ["id", "name", "category", "priority", "due", "completed", "recurring", "completedOn"], "required": ["id", "name", "category", "priority", "due", "completed", "recurring"], "types": {"name": "string", "category": "string", "priority": "string", "due": "string", "completed": "boolean", "recurring": "boolean", "completedOn": "string"}}, "courses": {"table": "courses", "fields": ["id", "name", "code", "instructor", "grade", "notes"], "required": ["id", "name", "code", "instructor", "notes"], "types": {"name": "string", "code": "string", "instructor": "string", "grade": "number", "notes": "string"}}, "assignments": {"table": "school_work", "fields": ["id", "name", "courseId", "due", "type", "completed", "completedOn", "grade", "notes"], "required": ["id", "name", "courseId", "due", "type", "completed"], "types": {"name": "string", "courseId": "string", "due": "string", "type": "string", "completed": "boolean", "completedOn": "string", "grade": "number", "notes": "string"}}, "weights": {"table": "weight_entries", "fields": ["id", "date", "value"], "required": ["id", "date", "value"], "types": {"date": "string", "value": "number"}}, "nutrition": {"table": "daily_nutrition", "fields": ["id", "date", "calories", "protein", "steps"], "required": ["id", "date", "calories", "protein", "steps"], "types": {"date": "string", "calories": "number", "protein": "number", "steps": "number"}}, "workouts": {"table": "workout_entries", "fields": ["id", "date", "name", "exercise", "weight", "reps", "sets", "completed"], "required": ["id", "date", "name", "exercise", "weight", "reps", "completed"], "types": {"date": "string", "name": "string", "exercise": "string", "weight": "number", "reps": "number", "sets": "number", "completed": "boolean"}}, "habits": {"table": "habits", "fields": ["id", "name", "dates", "createdOn", "target", "schedule", "counts", "scheduleHistory"], "required": ["id", "name", "dates"], "types": {"name": "string", "dates": "array", "createdOn": "string", "target": "number", "schedule": "array", "counts": "object", "scheduleHistory": "array"}}, "dates": {"table": "important_dates", "fields": ["id", "name", "date"], "required": ["id", "name", "date"], "types": {"name": "string", "date": "string"}}, "commitments": {"table": "commitment_series", "fields": ["id", "name", "kind", "days", "startTime", "endTime", "startsOn", "endsOn", "exceptions"], "required": ["id", "name", "kind", "days", "startTime", "endTime", "startsOn", "exceptions"], "types": {"name": "string", "kind": "string", "days": "array", "startTime": "string", "endTime": "string", "startsOn": "string", "endsOn": "string", "exceptions": "array"}}, "weeklyReflections": {"table": "weekly_reflections", "fields": ["id", "weekStart", "reflection", "priorities", "savedAt"], "required": ["id", "weekStart", "reflection", "priorities", "savedAt"], "types": {"weekStart": "string", "reflection": "string", "priorities": "array", "savedAt": "string"}}}'::jsonb -> kind;
 if model is null then raise exception 'Unknown domain' using errcode='22023'; end if;
 return model;
end $$;
create function dylan_private.valid_date(value text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin return coalesce(value ~ '^\d{4}-\d{2}-\d{2}$' and (value::date)::text=value,false); exception when others then return false; end $$;
create function dylan_private.validate_record(kind text, data jsonb) returns void language plpgsql set search_path=pg_catalog as $$
declare model jsonb := dylan_private.model(kind); k text; value jsonb; expected text; item jsonb; n numeric;
begin
 if jsonb_typeof(data) is distinct from 'object' or octet_length(data::text)>131072 then raise exception 'Invalid or oversized record' using errcode='22023'; end if;
 for k in select jsonb_array_elements_text(model->'required') loop
  if not data ? k or (data->k='null'::jsonb and k not in ('grade','endsOn')) then raise exception 'Missing required field: %',k using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(data->'id') <> 'string' or length(trim(data->>'id')) not between 1 and 200 then raise exception 'Invalid record ID' using errcode='22023'; end if;
 if kind='courses' and not data ? 'grade' then raise exception 'Missing course grade' using errcode='22023'; end if;
 if kind='commitments' and not data ? 'endsOn' then raise exception 'Missing commitment end date' using errcode='22023'; end if;
 for k, value in select e.key, e.value from jsonb_each(data) e loop
  expected := model->'types'->>k;
  if expected is not null and value='null'::jsonb and k not in ('grade','endsOn') then raise exception 'Invalid null field' using errcode='22023'; end if;
  if k=any(array['name','category','code','exercise']) and length(trim(data->>k))=0 then raise exception 'Blank required text' using errcode='22023'; end if;
  if expected is not null and value<>'null'::jsonb and jsonb_typeof(value)<>expected then raise exception 'Invalid type: %',k using errcode='22023'; end if;
  if k=any(array['date','due','completedOn','createdOn','startsOn','endsOn','weekStart']) and value<>'null'::jsonb and not dylan_private.valid_date(data->>k) then raise exception 'Invalid calendar date' using errcode='22023'; end if;
 end loop;
 for k in select unnest(array['days','schedule','exceptions','dates','priorities']) loop
  if data ? k and data->k<>'null'::jsonb then
   if (select count(*) from jsonb_array_elements(data->k)) <> (select count(distinct e.value) from jsonb_array_elements(data->k) e) then raise exception 'Duplicate array entry' using errcode='22023'; end if;
   for item in select e.value from jsonb_array_elements(data->k) e loop
    if k in ('days','schedule') and (jsonb_typeof(item)<>'number' or item::text !~ '^[0-6]$') then raise exception 'Invalid weekday' using errcode='22023'; end if;
    if k in ('dates','exceptions') and (jsonb_typeof(item)<>'string' or not dylan_private.valid_date(item#>>'{}')) then raise exception 'Invalid history date' using errcode='22023'; end if;
    if k='priorities' and (jsonb_typeof(item)<>'string' or length(trim(item#>>'{}'))=0) then raise exception 'Invalid priority' using errcode='22023'; end if;
   end loop;
  end if;
 end loop;
 if kind='weeklyReflections' and (select count(distinct lower(trim(e.value))) from jsonb_array_elements_text(data->'priorities') e(value))<>3 then raise exception 'Duplicate weekly priorities' using errcode='22023'; end if;
 if kind='habits' and data ? 'counts' and data->'counts'<>'null'::jsonb then
  for k, value in select e.key,e.value from jsonb_each(data->'counts') e loop
   if not dylan_private.valid_date(k) or jsonb_typeof(value)<>'number' or value::text !~ '^\d+$' or (value::text)::numeric>100 then raise exception 'Invalid habit count' using errcode='22023'; end if;
  end loop;
 end if;
 if kind='habits' and data ? 'scheduleHistory' and data->'scheduleHistory'<>'null'::jsonb then
  for item in select e.value from jsonb_array_elements(data->'scheduleHistory') e loop
   if jsonb_typeof(item) is distinct from 'object' or not dylan_private.valid_date(item->>'effectiveOn') or jsonb_typeof(item->'days') is distinct from 'array' or jsonb_array_length(item->'days')=0 or jsonb_typeof(item->'target') is distinct from 'number' then raise exception 'Invalid habit plan' using errcode='22023'; end if;
   n := (item->>'target')::numeric;
   if n<1 or n>100 or n<>trunc(n) or exists(select 1 from jsonb_array_elements(item->'days') day where day::text !~ '^[0-6]$') then raise exception 'Invalid habit plan values' using errcode='22023'; end if;
  end loop;
 end if;
end $$;
create function dylan_private.write_record(who uuid, kind text, data jsonb, expected bigint, next_revision bigint) returns void language plpgsql set search_path=pg_catalog as $$
declare model jsonb := dylan_private.model(kind); tab text := model->>'table'; cols text; updates text; old_revision bigint; fields text[]; known jsonb; extra jsonb; populated jsonb;
begin
 perform dylan_private.validate_record(kind,data);
 if kind='commitments' and exists(select 1 from public.commitment_series r where r.user_id=who and r.id<>data->>'id' and lower(trim(r.name))=lower(trim(data->>'name')) and r.kind=data->>'kind' and r."startTime"=data->>'startTime' and r."endTime"=data->>'endTime' and r."startsOn"=(data->>'startsOn')::date and r."endsOn" is not distinct from (data->>'endsOn')::date and (select array_agg(d order by d) from unnest(r.days) d)=(select array_agg(d::integer order by d::integer) from jsonb_array_elements_text(data->'days') d)) then raise exception 'Duplicate recurring commitment' using errcode='22023'; end if;

 execute format('select revision from public.%I where user_id=$1 and id=$2',tab) into old_revision using who,data->>'id';
 if coalesce(old_revision,0)<>expected then raise exception 'Record revision conflict' using errcode='PT409'; end if;
 select array_agg(key) into fields from jsonb_each(data) where key in (select jsonb_array_elements_text(model->'fields'));
 select coalesce(jsonb_object_agg(key,value),'{}') into known from jsonb_each(data) where key=any(fields);
 select coalesce(jsonb_object_agg(key,value),'{}') into extra from jsonb_each(data) where not(key=any(fields));
 populated := known || jsonb_build_object('user_id',who,'revision',next_revision,'extensions',extra,'present_fields',fields,'created_at',null,'updated_at',now());
 select string_agg(format('%I',x),','), string_agg(format('%I=excluded.%I',x,x),',') into cols,updates
 from unnest(array['revision','updated_at','extensions','present_fields'] || array(select jsonb_array_elements_text(model->'fields'))) x;
 execute format('insert into public.%1$I(user_id,%2$s) select user_id,%2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict(user_id,id) do update set %3$s',tab,cols,updates) using populated;
end $$;
create function dylan_private.export_state(who uuid) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result jsonb := jsonb_build_object('schemaVersion',6,'goalWeight',null); kind text; model jsonb; rows jsonb; prefs jsonb; goals record; extra jsonb;
begin
 select extensions into extra from public.account_workspaces where user_id=who;
 result := coalesce(extra,'{}'::jsonb) || result;
 for kind in select unnest(array['courses','tasks','assignments','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
  model := dylan_private.model(kind);
  execute format('select coalesce(jsonb_agg(r.extensions || (select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(to_jsonb(r)) where key=any(r.present_fields)) order by r.id),''[]'') from public.%I r where user_id=$1',model->>'table') into rows using who;
  result := result || jsonb_build_object(kind,rows);
 end loop;
 select preferences into prefs from public.workspace_preferences where user_id=who;
 if found then result := result || jsonb_build_object('preferences',prefs); end if;
 select * into goals from public.fitness_goals where user_id=who;
 if found then
  result := result || jsonb_build_object('goalWeight',goals.goal_weight);
  if 'fitnessGoals'=any(goals.present_fields) then result := result || jsonb_build_object('fitnessGoals',goals.extras || jsonb_build_object('calories',goals.calories,'protein',goals.protein,'steps',goals.steps,'weeklyWorkouts',goals.weekly_workouts)); end if;
 end if;
 return result;
end $$;
create function dylan_private.save_snapshot(who uuid, current_revision bigint, reason text) returns void language plpgsql set search_path=pg_catalog as $$
declare payload jsonb := dylan_private.export_state(who);
begin
 if octet_length(payload::text)>5242880 then raise exception 'Workspace exceeds staging size limit' using errcode='22023'; end if;
 insert into public.workspace_snapshots(user_id,revision,schema_version,payload,reason) values(who,current_revision,6,payload,reason);
 delete from public.workspace_snapshots where user_id=who and id not in(select id from public.workspace_snapshots where user_id=who order by created_at desc,id desc limit 5);
end $$;
create function dylan_private.set_preferences(who uuid, data jsonb, rev bigint) returns void language plpgsql set search_path=pg_catalog as $$
declare key text;
begin
 if jsonb_typeof(data) is distinct from 'object' or octet_length(data::text)>32768 then raise exception 'Invalid preferences' using errcode='22023'; end if;
 if data ? 'dashboard' then
  if jsonb_typeof(data->'dashboard') is distinct from 'object' then raise exception 'Invalid dashboard' using errcode='22023'; end if;
  for key in select unnest(array['order','hidden']) loop
   if jsonb_typeof(data->'dashboard'->key) is distinct from 'array' then raise exception 'Invalid dashboard list' using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements(data->'dashboard'->key) e where jsonb_typeof(e.value)<>'string') then raise exception 'Invalid dashboard item' using errcode='22023'; end if;
  end loop;
 end if;
 if data ? 'priorities' then
  if jsonb_typeof(data->'priorities') is distinct from 'object' or not dylan_private.valid_date(data->'priorities'->>'date') or jsonb_typeof(data->'priorities'->'ids') is distinct from 'array' or jsonb_array_length(data->'priorities'->'ids')>3 then raise exception 'Invalid task priorities' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(data->'priorities'->'ids') e where jsonb_typeof(e.value)<>'string') then raise exception 'Invalid priority ID' using errcode='22023'; end if;
 end if;
 insert into public.workspace_preferences(user_id,preferences,revision) values(who,data,rev) on conflict(user_id) do update set preferences=excluded.preferences,revision=excluded.revision;
end $$;
create function dylan_private.set_goals(who uuid, data jsonb, rev bigint) returns void language plpgsql set search_path=pg_catalog as $$
declare goals jsonb := data->'fitnessGoals'; key text; value jsonb;
begin
 if jsonb_typeof(data) is distinct from 'object' or not data ? 'goalWeight' or (data->'goalWeight'<>'null'::jsonb and jsonb_typeof(data->'goalWeight')<>'number') then raise exception 'Invalid weight goal' using errcode='22023'; end if;
 if goals is not null and jsonb_typeof(goals)<>'object' then raise exception 'Invalid fitness goals' using errcode='22023'; end if;
 if goals is not null then
  for key in select unnest(array['calories','protein','steps','weeklyWorkouts']) loop
   value := goals->key;
   if value is null or (value<>'null'::jsonb and jsonb_typeof(value)<>'number') then raise exception 'Invalid fitness goal field' using errcode='22023'; end if;
  end loop;
 end if;
 insert into public.fitness_goals(user_id,goal_weight,calories,protein,steps,weekly_workouts,extras,present_fields,revision)
 values(who,(data->>'goalWeight')::numeric,(goals->>'calories')::numeric,(goals->>'protein')::numeric,(goals->>'steps')::integer,(goals->>'weeklyWorkouts')::integer,coalesce(goals-'calories'-'protein'-'steps'-'weeklyWorkouts','{}'),case when goals is null then '{}'::text[] else array['fitnessGoals'] end,rev)
 on conflict(user_id) do update set goal_weight=excluded.goal_weight,calories=excluded.calories,protein=excluded.protein,steps=excluded.steps,weekly_workouts=excluded.weekly_workouts,extras=excluded.extras,present_fields=excluded.present_fields,revision=excluded.revision;
end $$;
create function public.dylan_read() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid := dylan_private.actor(); result jsonb; rev bigint; kind text; versions jsonb := '{}'; vals jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 select revision into rev from public.account_workspaces where user_id=who;
 result := dylan_private.export_state(who);
 for kind in select unnest(array['courses','tasks','assignments','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
  execute format('select coalesce(jsonb_object_agg(id,revision),''{}'') from public.%I where user_id=$1',dylan_private.model(kind)->>'table') into vals using who;
  versions := versions || jsonb_build_object(kind,vals);
 end loop;
 return jsonb_build_object('data',result,'revision',coalesce(rev,0),'recordRevisions',versions);
end $$;
create function public.dylan_export() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true); return dylan_private.export_state(dylan_private.actor()) || jsonb_build_object('exportedAt',now()); end $$;
create function public.dylan_command(command jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid := dylan_private.actor(); current_revision bigint; expected bigint; action text := command->>'action'; kind text := command->>'collection'; model jsonb; data jsonb; snapshot jsonb; item jsonb; affected integer;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 if jsonb_typeof(command)<>'object' or octet_length(command::text)>262144 or jsonb_typeof(command->'expectedRevision') is distinct from 'number' then raise exception 'Invalid command' using errcode='22023'; end if;
 if command ?| array['user_id','userId','owner','entitlements','permissions'] then raise exception 'Client authority is forbidden' using errcode='22023'; end if;
 if (command->>'expectedRevision') !~ '^\d+$' or (command->>'expectedRevision')::numeric > 9007199254740991 then raise exception 'Invalid workspace revision' using errcode='22023'; end if;
 expected := (command->>'expectedRevision')::bigint;
 if command ? 'expectedRecordRevision' and (jsonb_typeof(command->'expectedRecordRevision') <> 'number' or (command->>'expectedRecordRevision') !~ '^\d+$' or (command->>'expectedRecordRevision')::numeric > 9007199254740991) then raise exception 'Invalid record revision' using errcode='22023'; end if;
 insert into public.account_workspaces(user_id) values(who) on conflict do nothing;
 select revision into current_revision from public.account_workspaces where user_id=who for update;
 if current_revision<>expected then raise exception 'Workspace revision conflict' using errcode='PT409'; end if;
 if action='restore' then
  if command->>'confirmation' is distinct from 'RESTORE MY STAGING SNAPSHOT' then raise exception 'Restore confirmation required' using errcode='22023'; end if;
  select payload into snapshot from public.workspace_snapshots where user_id=who and id=(command->>'snapshotId')::uuid;
  if not found then raise exception 'Snapshot unavailable' using errcode='42501'; end if;
 end if;
 perform dylan_private.save_snapshot(who,current_revision,'Before ' || coalesce(action,'unknown') || ' staging command');
 if action='upsert' then
  if jsonb_typeof(command->'expectedRecordRevision') is distinct from 'number' then raise exception 'Missing record revision' using errcode='22023'; end if;
  perform dylan_private.write_record(who,kind,command->'record',(command->>'expectedRecordRevision')::bigint,current_revision+1);
 elsif action='delete' then
  model := dylan_private.model(kind);
  if jsonb_typeof(command->'expectedRecordRevision') is distinct from 'number' or jsonb_typeof(command->'id') is distinct from 'string' then raise exception 'Invalid deletion' using errcode='22023'; end if;
  execute format('delete from public.%I where user_id=$1 and id=$2 and revision=$3',model->>'table') using who,command->>'id',(command->>'expectedRecordRevision')::bigint;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Record revision conflict' using errcode='PT409'; end if;
 elsif action='preferences' then perform dylan_private.set_preferences(who,command->'preferences',current_revision+1);
 elsif action='goals' then perform dylan_private.set_goals(who,command->'goals',current_revision+1);
 elsif action='restore' then
  -- Delete dependent records before parents; every reconstruction occurs in this transaction.
  for kind in select unnest(array['assignments','courses','tasks','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
   model := dylan_private.model(kind); execute format('delete from public.%I where user_id=$1',model->>'table') using who;
  end loop;
  delete from public.workspace_preferences where user_id=who; delete from public.fitness_goals where user_id=who;
  for kind in select unnest(array['courses','tasks','assignments','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
   for item in select value from jsonb_array_elements(snapshot->kind) loop
    perform dylan_private.write_record(who,kind,item,0,current_revision+1);
   end loop;
  end loop;
  if snapshot ? 'preferences' then perform dylan_private.set_preferences(who,snapshot->'preferences',current_revision+1); end if;
  perform dylan_private.set_goals(who,jsonb_build_object('goalWeight',snapshot->'goalWeight') || case when snapshot ? 'fitnessGoals' then jsonb_build_object('fitnessGoals',snapshot->'fitnessGoals') else '{}'::jsonb end,current_revision+1);
 else raise exception 'Unsupported staging command' using errcode='22023'; end if;
 -- Size limit includes the resulting data, so errors roll back snapshots and all row changes.
 if octet_length(dylan_private.export_state(who)::text)>5242880 then raise exception 'Workspace exceeds staging size limit' using errcode='22023'; end if;
 update public.account_workspaces set revision=current_revision+1,updated_at=now() where user_id=who;
 return public.dylan_read();
end $$;
revoke all on all functions in schema dylan_private from public,anon,authenticated;
grant execute on function dylan_private.actor() to authenticated;
revoke all on function public.dylan_read(), public.dylan_export(), public.dylan_command(jsonb) from public,anon,authenticated;
grant execute on function public.dylan_read(), public.dylan_export(), public.dylan_command(jsonb) to authenticated;
commit;
