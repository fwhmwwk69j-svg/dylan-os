-- Phase 2A: internal ordering only; portable schema remains 6. Local deployment only.
begin;
alter table public.tasks add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.tasks)
update public.tasks r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.tasks alter column position set not null;
alter table public.tasks add constraint tasks_position_nonnegative check(position>=0);
alter table public.tasks add constraint tasks_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.courses add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.courses)
update public.courses r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.courses alter column position set not null;
alter table public.courses add constraint courses_position_nonnegative check(position>=0);
alter table public.courses add constraint courses_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.school_work add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.school_work)
update public.school_work r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.school_work alter column position set not null;
alter table public.school_work add constraint school_work_position_nonnegative check(position>=0);
alter table public.school_work add constraint school_work_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.weight_entries add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.weight_entries)
update public.weight_entries r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.weight_entries alter column position set not null;
alter table public.weight_entries add constraint weight_entries_position_nonnegative check(position>=0);
alter table public.weight_entries add constraint weight_entries_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.daily_nutrition add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.daily_nutrition)
update public.daily_nutrition r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.daily_nutrition alter column position set not null;
alter table public.daily_nutrition add constraint daily_nutrition_position_nonnegative check(position>=0);
alter table public.daily_nutrition add constraint daily_nutrition_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.workout_entries add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.workout_entries)
update public.workout_entries r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.workout_entries alter column position set not null;
alter table public.workout_entries add constraint workout_entries_position_nonnegative check(position>=0);
alter table public.workout_entries add constraint workout_entries_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.habits add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.habits)
update public.habits r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.habits alter column position set not null;
alter table public.habits add constraint habits_position_nonnegative check(position>=0);
alter table public.habits add constraint habits_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.important_dates add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.important_dates)
update public.important_dates r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.important_dates alter column position set not null;
alter table public.important_dates add constraint important_dates_position_nonnegative check(position>=0);
alter table public.important_dates add constraint important_dates_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.commitment_series add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.commitment_series)
update public.commitment_series r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.commitment_series alter column position set not null;
alter table public.commitment_series add constraint commitment_series_position_nonnegative check(position>=0);
alter table public.commitment_series add constraint commitment_series_owner_position unique(user_id,position) deferrable initially deferred;
alter table public.weekly_reflections add column position bigint;
with ranked as (select user_id,id,row_number() over(partition by user_id order by id)-1 as pos from public.weekly_reflections)
update public.weekly_reflections r set position=ranked.pos from ranked where r.user_id=ranked.user_id and r.id=ranked.id;
alter table public.weekly_reflections alter column position set not null;
alter table public.weekly_reflections add constraint weekly_reflections_position_nonnegative check(position>=0);
alter table public.weekly_reflections add constraint weekly_reflections_owner_position unique(user_id,position) deferrable initially deferred;
create or replace function dylan_private.write_record(who uuid, kind text, data jsonb, expected bigint, next_revision bigint) returns void language plpgsql set search_path=pg_catalog as $$
declare model jsonb := dylan_private.model(kind); tab text := model->>'table'; cols text; updates text; old_revision bigint; old_position bigint; fields text[]; known jsonb; extra jsonb; populated jsonb;
begin
 perform dylan_private.validate_record(kind,data);
 if kind='commitments' and exists(select 1 from public.commitment_series r where r.user_id=who and r.id<>data->>'id' and lower(trim(r.name))=lower(trim(data->>'name')) and r.kind=data->>'kind' and r."startTime"=data->>'startTime' and r."endTime"=data->>'endTime' and r."startsOn"=(data->>'startsOn')::date and r."endsOn" is not distinct from (data->>'endsOn')::date and (select array_agg(d order by d) from unnest(r.days) d)=(select array_agg(d::integer order by d::integer) from jsonb_array_elements_text(data->'days') d)) then raise exception 'Duplicate recurring commitment' using errcode='22023'; end if;

 execute format('select revision,position from public.%I where user_id=$1 and id=$2',tab) into old_revision,old_position using who,data->>'id';
 if coalesce(old_revision,0)<>expected then raise exception 'Record revision conflict' using errcode='PT409'; end if;
 select array_agg(key) into fields from jsonb_each(data) where key in (select jsonb_array_elements_text(model->'fields'));
 select coalesce(jsonb_object_agg(key,value),'{}') into known from jsonb_each(data) where key=any(fields);
 select coalesce(jsonb_object_agg(key,value),'{}') into extra from jsonb_each(data) where not(key=any(fields));
 if old_position is null then
  execute format('select coalesce(max(position),-1)+1 from public.%I where user_id=$1',tab) into old_position using who;
 end if;
 populated := known || jsonb_build_object('user_id',who,'position',old_position,'revision',next_revision,'extensions',extra,'present_fields',fields,'created_at',null,'updated_at',now());
 select string_agg(format('%I',x),','), string_agg(format('%I=excluded.%I',x,x),',') into cols,updates
 from unnest(array['position','revision','updated_at','extensions','present_fields'] || array(select jsonb_array_elements_text(model->'fields'))) x;
 execute format('insert into public.%1$I(user_id,%2$s) select user_id,%2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict(user_id,id) do update set %3$s',tab,cols,updates) using populated;
end $$;
create or replace function dylan_private.export_state(who uuid) returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result jsonb := jsonb_build_object('schemaVersion',6,'goalWeight',null); kind text; model jsonb; rows jsonb; prefs jsonb; goals record; extra jsonb;
begin
 select extensions into extra from public.account_workspaces where user_id=who;
 result := coalesce(extra,'{}'::jsonb) || result;
 for kind in select unnest(array['courses','tasks','assignments','weights','nutrition','workouts','habits','dates','commitments','weeklyReflections']) loop
  model := dylan_private.model(kind);
  execute format('select coalesce(jsonb_agg(r.extensions || (select coalesce(jsonb_object_agg(key,value),''{}'') from jsonb_each(to_jsonb(r)) where key=any(r.present_fields)) order by r.position,r.id),''[]'') from public.%I r where user_id=$1',model->>'table') into rows using who;
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

commit;
