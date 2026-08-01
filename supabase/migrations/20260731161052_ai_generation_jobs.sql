create extension if not exists pgmq;

select pgmq.create('ai_generation_jobs');

create table private.ai_daily_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  reserved_count smallint not null default 0,
  consumed_count smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date),
  check (reserved_count >= 0),
  check (consumed_count >= 0),
  check (reserved_count + consumed_count <= 5)
);

create table private.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  target_date date not null,
  idempotency_key uuid not null,
  source_url text not null,
  source_host varchar(253) not null,
  source_title varchar(300),
  content_digest bytea,
  status varchar(24) not null default 'queued',
  attempt_count smallint not null default 0,
  provider_call_count smallint not null default 0,
  attention varchar(120),
  summary text,
  inspiration text,
  warnings jsonb not null default '[]'::jsonb,
  error_code varchar(80),
  error_message text,
  provider varchar(80) not null default 'deepseek',
  model varchar(160) not null default 'deepseek-v4-pro',
  thinking_enabled boolean not null default true,
  reasoning_effort varchar(16) not null default 'high',
  prompt_version varchar(40) not null default 'ai-summary-v1',
  prompt_tokens integer,
  prompt_cache_hit_tokens integer,
  prompt_cache_miss_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  system_fingerprint varchar(255),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result_expires_at timestamptz,
  metadata_expires_at timestamptz not null default (now() + interval '90 days'),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (user_id, quota_date)
    references private.ai_daily_quotas(user_id, quota_date),
  check (source_url <> '' and length(source_url) <= 2048),
  check (source_host <> ''),
  check (status in (
    'queued', 'fetching', 'generating', 'retryable',
    'succeeded', 'failed', 'cancelled'
  )),
  check (attempt_count between 0 and 3),
  check (provider_call_count >= 0),
  check (reasoning_effort in ('high', 'max')),
  check (summary is null or length(summary) <= 5000),
  check (inspiration is null or length(inspiration) <= 2000),
  check (jsonb_typeof(warnings) = 'array'),
  check (prompt_tokens is null or prompt_tokens >= 0),
  check (prompt_cache_hit_tokens is null or prompt_cache_hit_tokens >= 0),
  check (prompt_cache_miss_tokens is null or prompt_cache_miss_tokens >= 0),
  check (completion_tokens is null or completion_tokens >= 0),
  check (reasoning_tokens is null or reasoning_tokens >= 0),
  check (content_digest is null or octet_length(content_digest) = 32),
  check (
    (status in ('succeeded', 'failed', 'cancelled') and finished_at is not null)
    or (status not in ('succeeded', 'failed', 'cancelled') and finished_at is null)
  ),
  check (
    status <> 'succeeded'
    or result_expires_at is null
    or (
      attention is not null
      and summary is not null
      and inspiration is not null
      and source_title is not null
      and warnings is not null
    )
  ),
  check (
    status <> 'failed'
    or error_code is not null
  )
);

create index ai_generation_jobs_user_created_idx
  on private.ai_generation_jobs (user_id, created_at desc);
create index ai_generation_jobs_status_created_idx
  on private.ai_generation_jobs (status, created_at)
  where status in ('queued', 'retryable');
create index ai_generation_jobs_result_expiry_idx
  on private.ai_generation_jobs (result_expires_at)
  where result_expires_at is not null;
create index ai_generation_jobs_metadata_expiry_idx
  on private.ai_generation_jobs (metadata_expires_at)
  where status in ('succeeded', 'failed', 'cancelled');

create trigger ai_daily_quotas_touch_updated_at
before update on private.ai_daily_quotas
for each row execute function private.touch_updated_at();

create trigger ai_generation_jobs_touch_updated_at
before update on private.ai_generation_jobs
for each row execute function private.touch_updated_at();

revoke all on private.ai_daily_quotas
  from public, anon, authenticated, service_role;
revoke all on private.ai_generation_jobs
  from public, anon, authenticated, service_role;

create type public.ai_generation_job_record as (
  id uuid,
  user_id uuid,
  target_date date,
  idempotency_key uuid,
  source_url text,
  source_host varchar(253),
  source_title varchar(300),
  status varchar(24),
  attempt_count integer,
  provider_call_count integer,
  attention varchar(120),
  summary text,
  inspiration text,
  warnings jsonb,
  error_code varchar(80),
  error_message text,
  provider varchar(80),
  model varchar(160),
  thinking_enabled boolean,
  reasoning_effort varchar(16),
  prompt_version varchar(40),
  prompt_tokens integer,
  prompt_cache_hit_tokens integer,
  prompt_cache_miss_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  system_fingerprint varchar(255),
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result_expires_at timestamptz,
  metadata_expires_at timestamptz,
  updated_at timestamptz
);

create type public.ai_generation_job_with_quota as (
  job public.ai_generation_job_record,
  quota_used integer,
  quota_reserved integer,
  quota_consumed integer,
  quota_remaining integer
);

create function private.to_ai_generation_job_record(
  target private.ai_generation_jobs
)
returns public.ai_generation_job_record
language sql
stable
set search_path = ''
as $$
  select row(
    target.id,
    target.user_id,
    target.target_date,
    target.idempotency_key,
    target.source_url,
    target.source_host,
    target.source_title,
    target.status,
    target.attempt_count,
    target.provider_call_count,
    target.attention,
    target.summary,
    target.inspiration,
    target.warnings,
    target.error_code,
    target.error_message,
    target.provider,
    target.model,
    target.thinking_enabled,
    target.reasoning_effort,
    target.prompt_version,
    target.prompt_tokens,
    target.prompt_cache_hit_tokens,
    target.prompt_cache_miss_tokens,
    target.completion_tokens,
    target.reasoning_tokens,
    target.system_fingerprint,
    target.created_at,
    target.started_at,
    target.finished_at,
    target.result_expires_at,
    target.metadata_expires_at,
    target.updated_at
  )::public.ai_generation_job_record;
$$;

revoke all on function private.to_ai_generation_job_record(private.ai_generation_jobs)
  from public, anon, authenticated, service_role;

create function public.create_ai_generation_job(
  target_user_id uuid,
  target_date date,
  target_idempotency_key uuid,
  target_source_url text,
  target_source_host text
)
returns setof public.ai_generation_job_with_quota
language plpgsql
security definer
set search_path = ''
as $$
declare
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
    or pg_catalog.length(target_source_host) > 253 then
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
    source_host
  ) values (
    target_user_id,
    current_quota_date,
    target_date,
    target_idempotency_key,
    target_source_url,
    pg_catalog.lower(target_source_host)
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

create function public.read_ai_generation_job(
  target_user_id uuid,
  target_job_id uuid
)
returns setof public.ai_generation_job_record
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_ai_generation_job_record(jobs)
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
    and jobs.user_id = target_user_id;
$$;

create function public.cancel_ai_generation_job(
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
    (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
end;
$$;

create function public.claim_ai_generation_job(target_job_id uuid)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_job private.ai_generation_jobs%rowtype;
begin
  update private.ai_generation_jobs jobs
  set status = 'fetching',
      attempt_count = jobs.attempt_count + 1
  where jobs.id = target_job_id
    and jobs.status in ('queued', 'retryable')
    and jobs.attempt_count < 3
  returning jobs.* into claimed_job;

  if not found then
    return;
  end if;

  return next private.to_ai_generation_job_record(claimed_job);
end;
$$;

create function public.mark_ai_generation_fetch_failure(
  target_job_id uuid,
  target_error_code text,
  target_error_message text,
  target_retryable boolean
)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  if target_error_code is null
    or target_error_message is null
    or target_retryable is null
    or target_error_code = ''
    or pg_catalog.length(target_error_code) > 80 then
    raise exception using errcode = '22023', message = 'invalid fetch failure';
  end if;

  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'fetching' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  if target_retryable and current_job.attempt_count < 3 then
    update private.ai_generation_jobs jobs
    set status = 'retryable',
        error_code = target_error_code,
        error_message = target_error_message
    where jobs.id = current_job.id
    returning jobs.* into current_job;
  else
    if current_job.started_at is null then
      update private.ai_daily_quotas quotas
      set reserved_count = quotas.reserved_count - 1
      where quotas.user_id = current_job.user_id
        and quotas.quota_date = current_job.quota_date;
    end if;

    update private.ai_generation_jobs jobs
    set status = 'failed',
        error_code = target_error_code,
        error_message = target_error_message,
        finished_at = pg_catalog.now(),
        result_expires_at = pg_catalog.now() + interval '24 hours'
    where jobs.id = current_job.id
    returning jobs.* into current_job;
  end if;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.begin_ai_generation(target_job_id uuid)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'fetching' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  if current_job.started_at is null then
    update private.ai_daily_quotas quotas
    set reserved_count = quotas.reserved_count - 1,
        consumed_count = quotas.consumed_count + 1
    where quotas.user_id = current_job.user_id
      and quotas.quota_date = current_job.quota_date;
  end if;

  update private.ai_generation_jobs jobs
  set status = 'generating',
      started_at = coalesce(jobs.started_at, pg_catalog.now()),
      error_code = null,
      error_message = null
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.complete_ai_generation_job(
  target_job_id uuid,
  target_succeeded boolean,
  target_attention text,
  target_summary text,
  target_inspiration text,
  target_source_title text,
  target_warnings jsonb,
  target_error_code text,
  target_error_message text,
  target_provider_call_count integer,
  target_prompt_tokens integer,
  target_prompt_cache_hit_tokens integer,
  target_prompt_cache_miss_tokens integer,
  target_completion_tokens integer,
  target_reasoning_tokens integer,
  target_model text,
  target_system_fingerprint text,
  target_content_digest bytea
)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  if target_succeeded is null
    or target_provider_call_count is null
    or target_provider_call_count < 0
    or target_model is null
    or target_model = ''
    or pg_catalog.length(target_model) > 160
    or (target_system_fingerprint is not null and pg_catalog.length(target_system_fingerprint) > 255)
    or (target_error_code is not null and pg_catalog.length(target_error_code) > 80)
    or (target_attention is not null and pg_catalog.length(target_attention) > 120)
    or (target_summary is not null and pg_catalog.length(target_summary) > 5000)
    or (target_inspiration is not null and pg_catalog.length(target_inspiration) > 2000)
    or (target_source_title is not null and pg_catalog.length(target_source_title) > 300)
    or (target_content_digest is not null and pg_catalog.octet_length(target_content_digest) <> 32)
    or target_warnings is null
    or pg_catalog.jsonb_typeof(target_warnings) <> 'array'
    or (target_prompt_tokens is not null and target_prompt_tokens < 0)
    or (target_prompt_cache_hit_tokens is not null and target_prompt_cache_hit_tokens < 0)
    or (target_prompt_cache_miss_tokens is not null and target_prompt_cache_miss_tokens < 0)
    or (target_completion_tokens is not null and target_completion_tokens < 0)
    or (target_reasoning_tokens is not null and target_reasoning_tokens < 0)
    or (
      target_succeeded
      and (
        target_attention is null
        or target_summary is null
        or target_inspiration is null
        or target_source_title is null
        or target_content_digest is null
      )
    )
    or (
      not target_succeeded
      and (
        target_error_code is null
        or target_error_message is null
        or target_error_code = ''
      )
    ) then
    raise exception using errcode = '22023', message = 'invalid AI completion';
  end if;

  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'generating' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  update private.ai_generation_jobs jobs
  set status = case when target_succeeded then 'succeeded' else 'failed' end,
      attention = case when target_succeeded then target_attention else null end,
      summary = case when target_succeeded then target_summary else null end,
      inspiration = case when target_succeeded then target_inspiration else null end,
      source_title = case when target_succeeded then target_source_title else null end,
      warnings = target_warnings,
      error_code = case when target_succeeded then null else target_error_code end,
      error_message = case when target_succeeded then null else target_error_message end,
      provider_call_count = jobs.provider_call_count + target_provider_call_count,
      prompt_tokens = target_prompt_tokens,
      prompt_cache_hit_tokens = target_prompt_cache_hit_tokens,
      prompt_cache_miss_tokens = target_prompt_cache_miss_tokens,
      completion_tokens = target_completion_tokens,
      reasoning_tokens = target_reasoning_tokens,
      model = target_model,
      system_fingerprint = target_system_fingerprint,
      content_digest = target_content_digest,
      finished_at = pg_catalog.now(),
      result_expires_at = pg_catalog.now() + interval '24 hours'
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.expire_ai_generation_data(target_limit integer)
returns table (cleared_results integer, deleted_jobs integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'target_limit must be between 1 and 500';
  end if;

  with candidates as (
    select jobs.id
    from private.ai_generation_jobs jobs
    where jobs.status in ('succeeded', 'failed', 'cancelled')
      and jobs.result_expires_at <= pg_catalog.now()
    order by jobs.result_expires_at, jobs.id
    limit target_limit
    for update skip locked
  ),
  cleared as (
    update private.ai_generation_jobs jobs
    set attention = null,
        summary = null,
        inspiration = null,
        source_title = null,
        warnings = '[]'::jsonb,
        error_message = null,
        content_digest = null,
        result_expires_at = null
    from candidates
    where jobs.id = candidates.id
    returning 1
  )
  select pg_catalog.count(*)::integer
  into cleared_results
  from cleared;

  with candidates as (
    select jobs.id
    from private.ai_generation_jobs jobs
    where jobs.status in ('succeeded', 'failed', 'cancelled')
      and jobs.metadata_expires_at <= pg_catalog.now()
    order by jobs.metadata_expires_at, jobs.id
    limit target_limit
    for update skip locked
  ),
  deleted as (
    delete from private.ai_generation_jobs jobs
    using candidates
    where jobs.id = candidates.id
    returning 1
  )
  select pg_catalog.count(*)::integer
  into deleted_jobs
  from deleted;

  return next;
end;
$$;

revoke all on function public.create_ai_generation_job(uuid, date, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_ai_generation_job(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_ai_generation_job(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_ai_generation_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_ai_generation_fetch_failure(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_ai_generation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_ai_generation_job(
  uuid, boolean, text, text, text, text, jsonb, text, text, integer,
  integer, integer, integer, integer, integer, text, text, bytea
)
  from public, anon, authenticated, service_role;
revoke all on function public.expire_ai_generation_data(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.create_ai_generation_job(uuid, date, uuid, text, text)
  to service_role;
grant execute on function public.read_ai_generation_job(uuid, uuid)
  to service_role;
grant execute on function public.cancel_ai_generation_job(uuid, uuid)
  to service_role;
grant execute on function public.claim_ai_generation_job(uuid)
  to service_role;
grant execute on function public.mark_ai_generation_fetch_failure(uuid, text, text, boolean)
  to service_role;
grant execute on function public.begin_ai_generation(uuid)
  to service_role;
grant execute on function public.complete_ai_generation_job(
  uuid, boolean, text, text, text, text, jsonb, text, text, integer,
  integer, integer, integer, integer, integer, text, text, bytea
)
  to service_role;
grant execute on function public.expire_ai_generation_data(integer)
  to service_role;
