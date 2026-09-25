begin;
-- Existing immutable jobs retain their prompt; only fresh inserts use v2.
alter table private.ai_generation_jobs
  alter column prompt_version set default 'knowledge-relations-v2';

-- Task creation must use the column default instead of pinning an older generator.
create or replace function public.create_ai_generation_job(
  target_user_id uuid,
  target_date date,
  target_idempotency_key uuid,
  target_source_url text,
  target_source_host text,
  target_user_prompt text default ''
)
returns setof public.ai_generation_job_with_quota
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_user_prompt text := pg_catalog.btrim(coalesce(target_user_prompt, ''));
  current_quota private.ai_daily_quotas%rowtype;
  existing_job private.ai_generation_jobs%rowtype;
  created_job private.ai_generation_jobs%rowtype;
  current_quota_date date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
begin
  if target_user_id is null
    or target_date is null
    or target_idempotency_key is null
    or target_source_url is null
    or target_source_host is null
    or target_source_url = ''
    or target_source_host = ''
    or pg_catalog.length(target_source_url) > 2048
    or pg_catalog.length(target_source_host) > 253
    or pg_catalog.char_length(normalized_user_prompt) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI generation job';
  end if;

  select jobs.*
  into existing_job
  from private.ai_generation_jobs jobs
  where jobs.user_id = target_user_id
    and jobs.idempotency_key = target_idempotency_key;

  if found then
    if existing_job.target_date is distinct from target_date
      or existing_job.source_url is distinct from target_source_url
      or existing_job.user_prompt is distinct from normalized_user_prompt then
      raise exception using errcode = 'P0001', message = 'AI_IDEMPOTENCY_CONFLICT';
    end if;

    select quotas.*
    into current_quota
    from private.ai_daily_quotas quotas
    where quotas.user_id = existing_job.user_id
      and quotas.quota_date = existing_job.quota_date;

    return query
    select
      private.to_ai_generation_job_record(existing_job),
      (current_quota.reserved_count + current_quota.consumed_count)::integer,
      current_quota.reserved_count::integer,
      current_quota.consumed_count::integer,
      (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
    return;
  end if;

  insert into private.ai_daily_quotas (user_id, quota_date)
  values (target_user_id, current_quota_date)
  on conflict (user_id, quota_date) do nothing;

  select quotas.*
  into current_quota
  from private.ai_daily_quotas quotas
  where quotas.user_id = target_user_id
    and quotas.quota_date = current_quota_date
  for update;

  select jobs.*
  into existing_job
  from private.ai_generation_jobs jobs
  where jobs.user_id = target_user_id
    and jobs.idempotency_key = target_idempotency_key;

  if found then
    if existing_job.target_date is distinct from target_date
      or existing_job.source_url is distinct from target_source_url
      or existing_job.user_prompt is distinct from normalized_user_prompt then
      raise exception using errcode = 'P0001', message = 'AI_IDEMPOTENCY_CONFLICT';
    end if;

    select quotas.*
    into current_quota
    from private.ai_daily_quotas quotas
    where quotas.user_id = existing_job.user_id
      and quotas.quota_date = existing_job.quota_date;

    return query
    select
      private.to_ai_generation_job_record(existing_job),
      (current_quota.reserved_count + current_quota.consumed_count)::integer,
      current_quota.reserved_count::integer,
      current_quota.consumed_count::integer,
      (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
    return;
  end if;

  if current_quota.reserved_count + current_quota.consumed_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_AI_LIMIT_REACHED';
  end if;

  update private.ai_daily_quotas quotas
  set reserved_count = quotas.reserved_count + 1
  where quotas.user_id = target_user_id
    and quotas.quota_date = current_quota_date
  returning quotas.* into current_quota;

  insert into private.ai_generation_jobs (
    user_id,
    quota_date,
    target_date,
    idempotency_key,
    source_url,
    source_host,
    user_prompt,
    prompt_version
  ) values (
    target_user_id,
    current_quota_date,
    target_date,
    target_idempotency_key,
    target_source_url,
    pg_catalog.lower(target_source_host),
    normalized_user_prompt,
    DEFAULT
  )
  returning * into created_job;

  perform pgmq.send(
    'ai_generation_jobs',
    pg_catalog.jsonb_build_object('job_id', created_job.id)
  );

  return query
  select
    private.to_ai_generation_job_record(created_job),
    (current_quota.reserved_count + current_quota.consumed_count)::integer,
    current_quota.reserved_count::integer,
    current_quota.consumed_count::integer,
    (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
end;
$$;
commit;
