-- Keep each existing row, including its ID, version, content and image, as manual.
alter table public.check_ins
  add column entry_mode text not null default 'manual',
  add constraint check_ins_entry_mode_check check (entry_mode in ('manual', 'ai'));

alter table public.check_ins
  drop constraint check_ins_user_date_key,
  add constraint check_ins_user_date_mode_key unique (user_id, checkin_date, entry_mode);

-- Account statistics continue to describe learning days across both entry modes.
create or replace function public.get_check_in_stats(target_today date)
returns table (
  total_count bigint,
  current_streak integer,
  has_today_record boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  owned_dates as materialized (
    select distinct records.checkin_date
    from public.check_ins records
    where records.user_id = (select auth.uid())
      and records.checkin_date <= target_today
  ),
  anchor as (
    select case
      when exists (
        select 1
        from owned_dates
        where checkin_date = target_today
      ) then target_today
      else target_today - 1
    end as day
  ),
  streak(day, length) as (
    select anchor.day, 0
    from anchor

    union all

    select streak.day - 1, streak.length + 1
    from streak
    where exists (
      select 1
      from owned_dates
      where checkin_date = streak.day
    )
  )
  select
    (
      select pg_catalog.count(distinct records.checkin_date)
      from public.check_ins records
      where records.user_id = (select auth.uid())
    )::bigint as total_count,
    coalesce((select pg_catalog.max(length) from streak), 0)::integer
      as current_streak,
    exists (
      select 1
      from owned_dates
      where checkin_date = target_today
    ) as has_today_record;
$$;

revoke all on function public.get_check_in_stats(date)
  from public, anon, authenticated;
grant execute on function public.get_check_in_stats(date) to authenticated;

-- Narrative generation reads only the selected mode; legacy requests default to manual.
-- Snapshot IDs keep later change detection tied to the actual source record.
drop function public.create_knowledge_narrative(uuid,date[],text,uuid);

create function public.create_knowledge_narrative(target_user_id uuid, target_dates date[], target_question text, target_idempotency_key uuid, target_entry_mode text default 'manual')
returns setof public.knowledge_narratives language plpgsql security definer set search_path = '' as $$
declare
  normalized_dates date[];
  snapshot jsonb;
  existing public.knowledge_narratives%rowtype;
  quota private.ai_daily_quotas%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if target_entry_mode is null or target_entry_mode not in ('manual','ai')
    or target_user_id is null or target_idempotency_key is null or target_question is null or length(btrim(target_question)) > 300
    or target_dates is null or cardinality(target_dates) not between 2 and 14 or array_position(target_dates, null) is not null then
    raise exception 'NARRATIVE_INVALID_INPUT';
  end if;
  select array_agg(d order by d) into normalized_dates from (select distinct unnest(target_dates) d) dates;
  if cardinality(normalized_dates) <> cardinality(target_dates) then raise exception 'NARRATIVE_INVALID_INPUT'; end if;
  -- Serialize requests per account, including idempotency requests spanning midnight.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 6401));
  select * into existing from public.knowledge_narratives where user_id = target_user_id and idempotency_key = target_idempotency_key;
  if found then
    if existing.dates <> normalized_dates or existing.question <> btrim(target_question)
      or coalesce(existing.source_snapshot->0->>'entryMode', 'manual') <> target_entry_mode then raise exception 'NARRATIVE_IDEMPOTENCY_CONFLICT'; end if;
    return next existing; return;
  end if;
  -- Source content and versions are read together in one statement. Never accept a client-provided snapshot.
  select jsonb_agg(jsonb_build_object('id', id, 'entryMode', entry_mode, 'date', checkin_date, 'attention', attention, 'summary', summary,
    'inspiration', inspiration, 'version', version, 'sourceUrl', coalesce(source_url,''), 'hasImage', image_path is not null) order by checkin_date)
    into snapshot from public.check_ins where user_id = target_user_id and entry_mode = target_entry_mode and checkin_date = any(normalized_dates);
  if snapshot is null or jsonb_array_length(snapshot) <> cardinality(normalized_dates) then raise exception 'NARRATIVE_SOURCES_MISSING'; end if;
  insert into private.ai_daily_quotas(user_id, quota_date) values(target_user_id,today) on conflict do nothing;
  select * into quota from private.ai_daily_quotas where user_id = target_user_id and quota_date = today for update;
  if quota.reserved_count + quota.consumed_count >= 5 then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count = reserved_count + 1, updated_at = now() where user_id = target_user_id and quota_date = today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,normalized_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;

revoke all on function public.create_knowledge_narrative(uuid,date[],text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_knowledge_narrative(uuid,date[],text,uuid,text) to service_role;
