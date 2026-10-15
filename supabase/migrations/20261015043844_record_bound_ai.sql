begin;

-- An immutable identity, deliberately without an FK: a removed record must not
-- be recreated, and retaining its ID avoids record/job lock inversions on delete.
alter table private.ai_generation_jobs
  add column record_id uuid,
  add column base_version integer check (base_version is null or base_version >= 1);
alter type public.ai_generation_job_record add attribute record_id uuid;
alter type public.ai_generation_job_record add attribute base_version integer;

create or replace function private.to_ai_generation_job_record(target private.ai_generation_jobs)
returns public.ai_generation_job_record language sql stable set search_path = '' as $$
  select row(
    target.id, target.user_id, target.target_date, target.idempotency_key,
    target.source_url, target.source_host, target.source_title, target.status,
    target.attempt_count, target.provider_call_count, target.attention, target.summary,
    target.inspiration, target.warnings, target.error_code, target.error_message,
    target.provider, target.model, target.thinking_enabled, target.reasoning_effort,
    target.prompt_version, target.prompt_tokens, target.prompt_cache_hit_tokens,
    target.prompt_cache_miss_tokens, target.completion_tokens, target.reasoning_tokens,
    target.system_fingerprint, target.created_at, target.started_at, target.finished_at,
    target.result_expires_at, target.metadata_expires_at, target.updated_at,
    target.user_prompt, target.progress, target.record_id, target.base_version
  )::public.ai_generation_job_record;
$$;

create function private.ai_record_candidate(job private.ai_generation_jobs)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'jobId', job.id, 'sourceUrl', job.source_url, 'userPrompt', job.user_prompt,
    'baseVersion', job.base_version,
    'generationContext', pg_catalog.jsonb_build_object('userPrompt', job.user_prompt, 'promptVersion', job.prompt_version),
    'result', pg_catalog.jsonb_build_object('attention', job.attention, 'summary', job.summary,
      'inspiration', job.inspiration, 'sourceTitle', job.source_title, 'warnings', job.warnings),
    'createdAt', coalesce(job.finished_at, pg_catalog.now())
  );
$$;
revoke all on function private.ai_record_candidate(private.ai_generation_jobs) from public, anon, authenticated, service_role;

-- Every recoverable legacy task gets its own explicit record. Matching by date
-- would lose earlier results or overwrite a previously accepted summary.
do $$
declare job private.ai_generation_jobs%rowtype; recovered_id uuid;
begin
  for job in select * from private.ai_generation_jobs
    where status in ('queued', 'fetching', 'generating', 'retryable')
       or (status = 'succeeded' and attention is not null and summary is not null
           and inspiration is not null and source_title is not null)
  loop
    if job.target_date > (pg_catalog.now() at time zone 'Asia/Shanghai')::date then
      -- Old clients once allowed future dates; never create an invalid record.
      if job.status in ('queued', 'fetching', 'generating', 'retryable') then
        perform public.cancel_ai_generation_job_v2(job.user_id, job.id, true);
      end if;
      continue;
    end if;
    recovered_id := pg_catalog.gen_random_uuid();
    insert into public.check_ins(id, user_id, checkin_date, entry_mode, attention,
      source_url, user_prompt, learning_status, completed_at)
    values(recovered_id, job.user_id, job.target_date, 'ai', pg_catalog.left(job.source_host, 120),
      job.source_url, job.user_prompt, 'pending', null);
    update private.ai_generation_jobs set record_id = recovered_id, base_version = 1
    where id = job.id returning * into job;
    update public.check_ins set
      active_ai_job_id = case when job.status in ('queued','fetching','generating','retryable') then job.id else null end,
      ai_status = job.status,
      ai_candidate = case when job.status = 'succeeded' then private.ai_record_candidate(job) else null end
    where id = recovered_id;
  end loop;
end;
$$;

create unique index ai_generation_jobs_one_live_record
  on private.ai_generation_jobs(record_id)
  where record_id is not null and status in ('queued', 'fetching', 'generating', 'retryable');

create function private.protect_ai_record_binding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.record_id is distinct from old.record_id or new.base_version is distinct from old.base_version
    or new.user_id is distinct from old.user_id or new.target_date is distinct from old.target_date
    or new.source_url is distinct from old.source_url then
    raise exception using errcode = 'P0001', message = 'AI_RECORD_BINDING_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_ai_record_binding() from public, anon, authenticated, service_role;
create trigger ai_generation_jobs_immutable_record before update of record_id, base_version, user_id, target_date, source_url
  on private.ai_generation_jobs for each row execute function private.protect_ai_record_binding();

-- Runs inside the worker completion transaction, so browser closure and task
-- result/metadata expiration cannot lose the candidate. Accepted content and
-- reflection are never assigned here; candidate acceptance checks baseVersion.
create function private.sync_ai_record_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.record_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status in ('queued', 'fetching', 'generating', 'retryable') then
    update public.check_ins set active_ai_job_id = new.id, ai_status = new.status, ai_error = null
    where id = new.record_id and user_id = new.user_id;
  else
    update public.check_ins set active_ai_job_id = null, ai_status = new.status,
      ai_error = case when new.status = 'failed' then new.error_code else null end,
      ai_candidate = case when new.status = 'succeeded'
        then private.ai_record_candidate(new) else ai_candidate end
    where id = new.record_id and user_id = new.user_id and active_ai_job_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_ai_record_state() from public, anon, authenticated, service_role;
create trigger ai_generation_jobs_sync_record after insert or update of status on private.ai_generation_jobs
  for each row execute function private.sync_ai_record_state();

create function public.create_record_ai_generation_job(
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
      quota.consumed_count::integer, (5 - quota.reserved_count - quota.consumed_count)::integer;
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
  if quota.reserved_count + quota.consumed_count >= 5 then
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
    quota.consumed_count::integer, (5 - quota.reserved_count - quota.consumed_count)::integer;
end;
$$;
revoke all on function public.create_record_ai_generation_job(uuid,date,uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.create_record_ai_generation_job(uuid,date,uuid,text,text,text,uuid) to service_role;

create or replace function public.create_ai_generation_job(
  target_user_id uuid, target_date date, target_idempotency_key uuid,
  target_source_url text, target_source_host text, target_user_prompt text default ''
)
returns setof public.ai_generation_job_with_quota
language sql security definer set search_path = '' as $$
  select * from public.create_record_ai_generation_job(target_user_id, target_date,
    target_idempotency_key, target_source_url, target_source_host, target_user_prompt, null);
$$;

notify pgrst, 'reload schema';
commit;
