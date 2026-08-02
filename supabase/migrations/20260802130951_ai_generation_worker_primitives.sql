create or replace function public.claim_ai_generation_job(target_job_id uuid)
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

  if not found or current_job.status not in (
    'queued', 'fetching', 'generating', 'retryable'
  ) then
    return;
  end if;

  if current_job.attempt_count >= 3 then
    if current_job.started_at is null then
      update private.ai_daily_quotas quotas
      set reserved_count = quotas.reserved_count - 1
      where quotas.user_id = current_job.user_id
        and quotas.quota_date = current_job.quota_date;
    end if;

    update private.ai_generation_jobs jobs
    set status = 'failed',
        error_code = 'TASK_RETRY_EXHAUSTED',
        error_message = '任务多次尝试后仍未成功',
        finished_at = pg_catalog.now(),
        result_expires_at = pg_catalog.now() + interval '24 hours'
    where jobs.id = current_job.id;
    return;
  end if;

  update private.ai_generation_jobs jobs
  set status = 'fetching',
      attempt_count = jobs.attempt_count + 1,
      error_code = null,
      error_message = null
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.read_ai_generation_queue(
  target_visibility_timeout integer,
  target_batch_limit integer
)
returns table (
  msg_id bigint,
  read_count integer,
  enqueued_at timestamptz,
  visible_at timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_visibility_timeout is null
    or target_visibility_timeout < 30
    or target_visibility_timeout > 900
    or target_batch_limit is null
    or target_batch_limit < 1
    or target_batch_limit > 5 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI queue read parameters';
  end if;

  return query
  select
    delivery.msg_id,
    delivery.read_ct,
    delivery.enqueued_at,
    delivery.vt,
    delivery.message
  from pgmq.read(
    'ai_generation_jobs',
    target_visibility_timeout,
    target_batch_limit
  ) as delivery;
end;
$$;

create function public.delete_ai_generation_queue_message(target_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_msg_id is null or target_msg_id < 1 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI queue message id';
  end if;

  return pgmq.delete('ai_generation_jobs', target_msg_id);
end;
$$;

create function public.delay_ai_generation_queue_message(
  target_msg_id bigint,
  target_delay_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delayed boolean;
begin
  if target_msg_id is null
    or target_msg_id < 1
    or target_delay_seconds is null
    or target_delay_seconds < 1
    or target_delay_seconds > 300 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI queue delay parameters';
  end if;

  select exists(
    select 1
    from pgmq.set_vt(
      'ai_generation_jobs',
      target_msg_id,
      target_delay_seconds
    )
  ) into delayed;

  return delayed;
end;
$$;

create function private.accumulate_ai_generation_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'generating'
    and new.status in ('retryable', 'succeeded', 'failed')
    and new.provider_call_count > old.provider_call_count then
    new.prompt_tokens := case
      when old.prompt_tokens is null and new.prompt_tokens is null then null
      else coalesce(old.prompt_tokens, 0) + coalesce(new.prompt_tokens, 0)
    end;
    new.prompt_cache_hit_tokens := case
      when old.prompt_cache_hit_tokens is null and new.prompt_cache_hit_tokens is null then null
      else coalesce(old.prompt_cache_hit_tokens, 0) + coalesce(new.prompt_cache_hit_tokens, 0)
    end;
    new.prompt_cache_miss_tokens := case
      when old.prompt_cache_miss_tokens is null and new.prompt_cache_miss_tokens is null then null
      else coalesce(old.prompt_cache_miss_tokens, 0) + coalesce(new.prompt_cache_miss_tokens, 0)
    end;
    new.completion_tokens := case
      when old.completion_tokens is null and new.completion_tokens is null then null
      else coalesce(old.completion_tokens, 0) + coalesce(new.completion_tokens, 0)
    end;
    new.reasoning_tokens := case
      when old.reasoning_tokens is null and new.reasoning_tokens is null then null
      else coalesce(old.reasoning_tokens, 0) + coalesce(new.reasoning_tokens, 0)
    end;
  end if;

  return new;
end;
$$;

create trigger ai_generation_jobs_accumulate_usage
before update on private.ai_generation_jobs
for each row execute function private.accumulate_ai_generation_usage();

create function public.mark_ai_generation_provider_failure(
  target_job_id uuid,
  target_error_code text,
  target_error_message text,
  target_retryable boolean,
  target_provider_call_count integer,
  target_prompt_tokens integer,
  target_prompt_cache_hit_tokens integer,
  target_prompt_cache_miss_tokens integer,
  target_completion_tokens integer,
  target_reasoning_tokens integer
)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
  retry_allowed boolean;
begin
  if target_job_id is null
    or target_error_code is null
    or target_error_code = ''
    or pg_catalog.length(target_error_code) > 80
    or target_error_message is null
    or target_retryable is null
    or target_provider_call_count is null
    or target_provider_call_count < 0
    or target_prompt_tokens is null
    or target_prompt_tokens < 0
    or target_prompt_cache_hit_tokens is null
    or target_prompt_cache_hit_tokens < 0
    or target_prompt_cache_miss_tokens is null
    or target_prompt_cache_miss_tokens < 0
    or target_completion_tokens is null
    or target_completion_tokens < 0
    or target_reasoning_tokens is null
    or target_reasoning_tokens < 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid provider failure';
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

  retry_allowed := target_retryable and current_job.attempt_count < 3;

  update private.ai_generation_jobs jobs
  set status = case when retry_allowed then 'retryable' else 'failed' end,
      error_code = target_error_code,
      error_message = target_error_message,
      provider_call_count = jobs.provider_call_count + target_provider_call_count,
      prompt_tokens = target_prompt_tokens,
      prompt_cache_hit_tokens = target_prompt_cache_hit_tokens,
      prompt_cache_miss_tokens = target_prompt_cache_miss_tokens,
      completion_tokens = target_completion_tokens,
      reasoning_tokens = target_reasoning_tokens,
      finished_at = case when retry_allowed then null else pg_catalog.now() end,
      result_expires_at = case
        when retry_allowed then null
        else pg_catalog.now() + interval '24 hours'
      end
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

revoke all on function public.read_ai_generation_queue(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_ai_generation_queue_message(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.delay_ai_generation_queue_message(bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.accumulate_ai_generation_usage()
  from public, anon, authenticated, service_role;
revoke all on function public.mark_ai_generation_provider_failure(
  uuid, text, text, boolean, integer, integer, integer, integer, integer, integer
)
  from public, anon, authenticated, service_role;

grant execute on function public.read_ai_generation_queue(integer, integer)
  to service_role;
grant execute on function public.delete_ai_generation_queue_message(bigint)
  to service_role;
grant execute on function public.delay_ai_generation_queue_message(bigint, integer)
  to service_role;
grant execute on function public.mark_ai_generation_provider_failure(
  uuid, text, text, boolean, integer, integer, integer, integer, integer, integer
)
  to service_role;
