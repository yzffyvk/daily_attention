begin;

-- Editable requirements and the context of existing generated content are distinct.
alter table public.check_ins
  add column user_prompt text not null default '',
  add column ai_generation_context jsonb,
  add constraint check_ins_user_prompt_length check (char_length(user_prompt) <= 1000),
  add constraint check_ins_ai_generation_context_shape check (
    ai_generation_context is null or coalesce((
      jsonb_typeof(ai_generation_context) = 'object'
      and ai_generation_context ?& array['userPrompt', 'promptVersion']
      and ai_generation_context - array['userPrompt', 'promptVersion'] = '{}'::jsonb
      and jsonb_typeof(ai_generation_context->'userPrompt') = 'string'
      and char_length(ai_generation_context->>'userPrompt') <= 1000
      and jsonb_typeof(ai_generation_context->'promptVersion') = 'string'
      and char_length(btrim(ai_generation_context->>'promptVersion')) between 1 and 40
    ), false)
  ),
  add constraint check_ins_manual_has_no_ai_context check (
    entry_mode = 'ai' or (user_prompt = '' and ai_generation_context is null)
  );

create function private.clear_manual_check_in_ai_context()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entry_mode = 'manual' then
    new.user_prompt := '';
    new.ai_generation_context := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_manual_check_in_ai_context()
  from public, anon, authenticated, service_role;
create trigger check_ins_clear_manual_ai_context
before insert or update on public.check_ins
for each row execute function private.clear_manual_check_in_ai_context();

-- Only future jobs receive the new version; existing snapshots are preserved.
alter table private.ai_generation_jobs
  add column user_prompt text not null default '',
  add constraint ai_generation_jobs_user_prompt_length check (char_length(user_prompt) <= 1000),
  alter column prompt_version set default 'knowledge-skeleton-user-prompt-v1';

create function private.protect_ai_generation_context()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_prompt is distinct from old.user_prompt
    or new.prompt_version is distinct from old.prompt_version then
    raise exception using errcode = 'P0001', message = 'AI_GENERATION_CONTEXT_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_ai_generation_context()
  from public, anon, authenticated, service_role;
create trigger ai_generation_jobs_immutable_context
before update of user_prompt, prompt_version on private.ai_generation_jobs
for each row execute function private.protect_ai_generation_context();

-- Appending an attribute preserves all existing RPC return types and worker paths.
alter type public.ai_generation_job_record add attribute user_prompt text;

create or replace function private.to_ai_generation_job_record(
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
    target.updated_at,
    target.user_prompt
  )::public.ai_generation_job_record;
$$;

-- A defaulted sixth argument preserves old five-argument calls without overloading.
drop function public.create_ai_generation_job(uuid, date, uuid, text, text);

create function public.create_ai_generation_job(
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
    'knowledge-skeleton-user-prompt-v1'
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

revoke all on function public.create_ai_generation_job(uuid, date, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_ai_generation_job(uuid, date, uuid, text, text, text)
  to service_role;

-- The existing metadata expiry deletes terminal jobs including their prompts;
-- result expiry intentionally keeps this context available for replay and retries.
commit;
