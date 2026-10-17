begin;

-- Managed explicitly by database administrators; never trust user-editable JWT metadata.
create table private.ai_quota_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);
alter table private.ai_quota_allowlist enable row level security;
revoke all on private.ai_quota_allowlist from public, anon, authenticated, service_role;

create function private.has_unlimited_ai_quota(target_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from private.ai_quota_allowlist where user_id = target_user_id);
$$;
revoke all on function private.has_unlimited_ai_quota(uuid) from public, anon, authenticated, service_role;

-- Keep accurate accounting for both bounded and unlimited accounts. Creation RPCs
-- retain their per-user row lock and enforce the ordinary daily allowance.
alter table private.ai_daily_quotas drop constraint ai_daily_quotas_check;
alter table private.ai_daily_quotas
  alter column reserved_count type integer,
  alter column consumed_count type integer;
alter type public.ai_generation_job_with_quota add attribute quota_unlimited boolean;

create function private.ai_quota_remaining(target_user_id uuid, used_count integer)
returns integer language sql stable set search_path = '' as $$
  select case when private.has_unlimited_ai_quota(target_user_id) then null
    else greatest(0, 5 - used_count) end;
$$;
revoke all on function private.ai_quota_remaining(uuid,integer) from public, anon, authenticated, service_role;


create or replace function public.create_record_ai_generation_job(
  target_user_id uuid, target_date date, target_idempotency_key uuid,
  target_source_url text, target_source_host text, target_user_prompt text,
  target_record_id uuid
)
returns setof public.ai_generation_job_with_quota
language plpgsql security definer set search_path = '' as $$
declare
  normalized_prompt text := pg_catalog.btrim(coalesce(target_user_prompt, ''));
  quota_day date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
  quota private.ai_daily_quotas%rowtype;
  job private.ai_generation_jobs%rowtype;
  current_record public.check_ins%rowtype;
begin
  if target_user_id is null or target_date is null or target_idempotency_key is null
    or target_source_url is null or target_source_host is null
    or target_source_url = '' or target_source_host = ''
    or pg_catalog.length(target_source_url) > 2048 or pg_catalog.length(target_source_host) > 253
    or pg_catalog.char_length(normalized_prompt) > 1000 then
    raise exception using errcode = '22023', message = 'invalid AI generation job';
  end if;
  if target_date > quota_day then
    raise exception using errcode = 'P0001', message = 'FUTURE_DATE_NOT_ALLOWED';
  end if;

  -- Per-user quota lock serializes idempotency before any record mutation.
  insert into private.ai_daily_quotas(user_id, quota_date)
  values(target_user_id, quota_day) on conflict do nothing;
  select * into quota from private.ai_daily_quotas q
  where q.user_id = target_user_id and q.quota_date = quota_day for update;
  select * into job from private.ai_generation_jobs j
  where j.user_id = target_user_id and j.idempotency_key = target_idempotency_key;
  if found then
    if job.target_date is distinct from target_date or job.source_url is distinct from target_source_url
      or job.user_prompt is distinct from normalized_prompt
      or (target_record_id is not null and job.record_id is distinct from target_record_id) then
      raise exception using errcode = 'P0001', message = 'AI_IDEMPOTENCY_CONFLICT';
    end if;
    select * into quota from private.ai_daily_quotas q
    where q.user_id = job.user_id and q.quota_date = job.quota_date;
    return query select private.to_ai_generation_job_record(job),
      (quota.reserved_count + quota.consumed_count)::integer, quota.reserved_count::integer,
      quota.consumed_count::integer, private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count),
      private.has_unlimited_ai_quota(target_user_id);
    return;
  end if;

  if target_record_id is null then
    -- Compatibility callers create a new independent pending item, never upsert a day.
    insert into public.check_ins(user_id, checkin_date, entry_mode, attention, source_url,
      user_prompt, learning_status, completed_at)
    values(target_user_id, target_date, 'ai', pg_catalog.left(target_source_host, 120), target_source_url,
      normalized_prompt, 'pending', null) returning * into current_record;
  else
    select * into current_record from public.check_ins c
    where c.id = target_record_id and c.user_id = target_user_id for update;
    if not found then raise exception using errcode = 'P0001', message = 'RECORD_NOT_FOUND'; end if;
    if current_record.checkin_date is distinct from target_date
      or public.normalize_learning_source_url(current_record.source_url) is distinct from target_source_url
      or pg_catalog.btrim(current_record.user_prompt) is distinct from normalized_prompt then
      raise exception using errcode = 'P0001', message = 'AI_RECORD_CONFLICT';
    end if;
    if exists(select 1 from private.ai_generation_jobs j where j.record_id = current_record.id
      and j.status in ('queued','fetching','generating','retryable')) then
      raise exception using errcode = 'P0001', message = 'AI_RECORD_BUSY';
    end if;
  end if;
  if quota.reserved_count + quota.consumed_count >= 5 and not private.has_unlimited_ai_quota(target_user_id) then
    raise exception using errcode = 'P0001', message = 'DAILY_AI_LIMIT_REACHED';
  end if;
  update private.ai_daily_quotas q set reserved_count = q.reserved_count + 1
  where q.user_id = target_user_id and q.quota_date = quota_day returning * into quota;
  insert into private.ai_generation_jobs(user_id, quota_date, target_date, idempotency_key,
    source_url, source_host, user_prompt, record_id, base_version)
  values(target_user_id, quota_day, target_date, target_idempotency_key, target_source_url,
    pg_catalog.lower(target_source_host), normalized_prompt, current_record.id, current_record.version) returning * into job;
  perform pgmq.send('ai_generation_jobs', pg_catalog.jsonb_build_object('job_id', job.id));
  return query select private.to_ai_generation_job_record(job),
    (quota.reserved_count + quota.consumed_count)::integer, quota.reserved_count::integer,
    quota.consumed_count::integer, private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count),
      private.has_unlimited_ai_quota(target_user_id);
end;
$$;

create or replace function public.cancel_ai_generation_job(
  target_user_id uuid,
  target_job_id uuid
)
returns setof public.ai_generation_job_with_quota
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
  current_quota private.ai_daily_quotas%rowtype;
begin
  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
    and jobs.user_id = target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_JOB';
  end if;

  if current_job.status <> 'queued' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  update private.ai_daily_quotas quotas
  set reserved_count = quotas.reserved_count - 1
  where quotas.user_id = current_job.user_id
    and quotas.quota_date = current_job.quota_date
  returning quotas.* into current_quota;

  update private.ai_generation_jobs jobs
  set status = 'cancelled',
      finished_at = pg_catalog.now(),
      result_expires_at = pg_catalog.now() + interval '24 hours'
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return query
  select
    private.to_ai_generation_job_record(current_job),
    (current_quota.reserved_count + current_quota.consumed_count)::integer,
    current_quota.reserved_count::integer,
    current_quota.consumed_count::integer,
    private.ai_quota_remaining(target_user_id, current_quota.reserved_count + current_quota.consumed_count),
    private.has_unlimited_ai_quota(target_user_id);
end;
$$;

create or replace function private.ai_generation_job_state(current_job private.ai_generation_jobs)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
  reserved integer := 0;
  consumed integer := 0;
  free_used integer := 0;
  unlimited boolean := private.has_unlimited_ai_quota(current_job.user_id);
begin
  select q.reserved_count, q.consumed_count into reserved, consumed
  from private.ai_daily_quotas q where q.user_id = current_job.user_id and q.quota_date = today;
  reserved := coalesce(reserved, 0);
  consumed := coalesce(consumed, 0);
  select a.used_count into free_used from private.ai_cancel_daily_allowances a
  where a.user_id = current_job.user_id and a.cancellation_date = today;
  free_used := coalesce(free_used, 0);
  return pg_catalog.jsonb_build_object(
    'job', pg_catalog.to_jsonb(private.to_ai_generation_job_record(current_job)),
    'quota', pg_catalog.jsonb_build_object('used', reserved + consumed, 'reserved', reserved,
      'consumed', consumed, 'limit', case when unlimited then null else 5 end,
      'remaining', private.ai_quota_remaining(current_job.user_id, reserved + consumed), 'unlimited', unlimited),
    'cancellation', pg_catalog.jsonb_build_object('freeRemaining', 2 - free_used,
      'requiresConfirmation', current_job.status in ('queued', 'fetching', 'generating', 'retryable')
        and current_job.started_at is not null and free_used >= 2 and not unlimited,
      'charged', case when current_job.status = 'cancelled'
        then not coalesce(current_job.cancelled_without_quota, true) else null end)
  );
end;
$$;

create or replace function public.cancel_ai_generation_job_v2(
  target_user_id uuid, target_job_id uuid, target_confirm_quota_consumption boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_job private.ai_generation_jobs%rowtype;
  today date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
  free_used integer;
  free_cancel boolean := true;
begin
  select jobs.* into current_job from private.ai_generation_jobs jobs
  where jobs.id = target_job_id and jobs.user_id = target_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_JOB';
  end if;
  -- The job lock decides completion/cancellation races and repeat requests once.
  if current_job.status in ('succeeded', 'failed', 'cancelled') then
    return private.ai_generation_job_state(current_job);
  end if;

  if current_job.started_at is null then
    update private.ai_daily_quotas q set reserved_count = q.reserved_count - 1
    where q.user_id = current_job.user_id and q.quota_date = current_job.quota_date;
  elsif private.has_unlimited_ai_quota(current_job.user_id) then
    -- No finite allowance is consumed, but settlement still refunds exactly once.
    update private.ai_daily_quotas q set consumed_count = q.consumed_count - 1
    where q.user_id = current_job.user_id and q.quota_date = current_job.quota_date;
  else
    insert into private.ai_cancel_daily_allowances(user_id, cancellation_date)
    values(current_job.user_id, today) on conflict do nothing;
    select a.used_count into free_used from private.ai_cancel_daily_allowances a
    where a.user_id = current_job.user_id and a.cancellation_date = today for update;
    if free_used < 2 then
      update private.ai_cancel_daily_allowances a set used_count = a.used_count + 1
      where a.user_id = current_job.user_id and a.cancellation_date = today;
      -- Cross-midnight tasks refund the day on which their slot was consumed.
      update private.ai_daily_quotas q set consumed_count = q.consumed_count - 1
      where q.user_id = current_job.user_id and q.quota_date = current_job.quota_date;
    elsif target_confirm_quota_consumption is not true then
      raise exception using errcode = 'P0001', message = 'CANCELLATION_CONFIRMATION_REQUIRED';
    else
      free_cancel := false; -- Keep the existing consumed slot; never charge again.
    end if;
  end if;

  update private.ai_generation_jobs jobs set status = 'cancelled',
    finished_at = pg_catalog.now(), result_expires_at = pg_catalog.now() + interval '24 hours',
    error_code = null, error_message = null, cancelled_without_quota = free_cancel
  where jobs.id = current_job.id returning jobs.* into current_job;
  return private.ai_generation_job_state(current_job);
end;
$$;

create or replace function public.create_knowledge_narrative(target_user_id uuid, target_dates date[], target_question text, target_idempotency_key uuid, target_entry_mode text default 'manual')
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
  if quota.reserved_count + quota.consumed_count >= 5 and not private.has_unlimited_ai_quota(target_user_id) then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count = reserved_count + 1, updated_at = now() where user_id = target_user_id and quota_date = today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,normalized_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;

create or replace function public.create_record_knowledge_narrative(target_user_id uuid, target_record_ids uuid[], target_question text, target_idempotency_key uuid)
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
  if quota.reserved_count+quota.consumed_count>=5 and not private.has_unlimited_ai_quota(target_user_id) then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count=reserved_count+1,updated_at=now() where user_id=target_user_id and quota_date=today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,source_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;

notify pgrst, 'reload schema';
commit;
