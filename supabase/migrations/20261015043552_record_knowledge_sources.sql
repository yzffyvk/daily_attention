-- Many completed records can share a date. Old snapshots/results remain untouched.
alter table public.knowledge_narratives drop constraint if exists knowledge_narratives_dates_check;
alter table public.knowledge_narratives add constraint knowledge_narratives_dates_check check (cardinality(dates) between 1 and 14);

create function public.create_record_knowledge_narrative(target_user_id uuid, target_record_ids uuid[], target_question text, target_idempotency_key uuid)
returns setof public.knowledge_narratives language plpgsql security definer set search_path = '' as $$
declare
  normalized_ids uuid[];
  existing_ids uuid[];
  source_dates date[];
  snapshot jsonb;
  existing public.knowledge_narratives%rowtype;
  quota private.ai_daily_quotas%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if target_user_id is null or target_idempotency_key is null or target_question is null or length(btrim(target_question)) > 300
    or target_record_ids is null or cardinality(target_record_ids) not between 2 and 14 or array_position(target_record_ids,null) is not null then
    raise exception 'NARRATIVE_INVALID_INPUT';
  end if;
  select array_agg(id order by id) into normalized_ids from (select distinct unnest(target_record_ids) id) records;
  if cardinality(normalized_ids) <> cardinality(target_record_ids) then raise exception 'NARRATIVE_INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text,6401));
  select * into existing from public.knowledge_narratives where user_id=target_user_id and idempotency_key=target_idempotency_key;
  if found then
    select array_agg((item->>'id')::uuid order by (item->>'id')::uuid) into existing_ids from jsonb_array_elements(existing.source_snapshot) item;
    if existing_ids is distinct from normalized_ids or existing.question <> btrim(target_question) then raise exception 'NARRATIVE_IDEMPOTENCY_CONFLICT'; end if;
    return next existing; return;
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'entryMode',entry_mode,'date',checkin_date,'attention',attention,'summary',summary,
    'inspiration',inspiration,'version',version,'sourceUrl',coalesce(source_url,''),'hasImage',image_path is not null) order by checkin_date,created_at,id),
    array_agg(distinct checkin_date order by checkin_date)
    into snapshot,source_dates from public.check_ins
    where user_id=target_user_id and id=any(normalized_ids) and learning_status='completed' and checkin_date<=today;
  if snapshot is null or jsonb_array_length(snapshot)<>cardinality(normalized_ids) then raise exception 'NARRATIVE_SOURCES_MISSING'; end if;
  insert into private.ai_daily_quotas(user_id,quota_date) values(target_user_id,today) on conflict do nothing;
  select * into quota from private.ai_daily_quotas where user_id=target_user_id and quota_date=today for update;
  if quota.reserved_count+quota.consumed_count>=5 then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count=reserved_count+1,updated_at=now() where user_id=target_user_id and quota_date=today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,source_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;
revoke all on function public.create_record_knowledge_narrative(uuid,uuid[],text,uuid) from public,anon,authenticated;
grant execute on function public.create_record_knowledge_narrative(uuid,uuid[],text,uuid) to service_role;
