-- Ephemeral public-output preview; final results keep their existing validation path.
alter table private.ai_generation_jobs add column progress jsonb;
alter type public.ai_generation_job_record add attribute progress jsonb;

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
    target.user_prompt,
    target.progress
  )::public.ai_generation_job_record;
$$;

create function private.clear_ai_generation_progress()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'generating' or new.attempt_count <> old.attempt_count then
    new.progress := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_ai_generation_progress() from public, anon, authenticated;
create trigger ai_generation_jobs_clear_progress
before update on private.ai_generation_jobs
for each row execute function private.clear_ai_generation_progress();

-- Service-only, attempt-fenced writes cannot revive a finished or retried job.
create function public.report_ai_generation_progress(
  target_job_id uuid, target_attempt_count integer, target_progress jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if target_progress is null
    or jsonb_typeof(target_progress) <> 'object'
    or not (target_progress ?& array['phase', 'preview', 'updatedAt'])
    or (target_progress - array['phase', 'preview', 'updatedAt']) <> '{}'::jsonb
    or jsonb_typeof(target_progress->'phase') <> 'string'
    or target_progress->>'phase' not in ('thinking', 'writing', 'repairing', 'validating')
    or jsonb_typeof(target_progress->'preview') <> 'string'
    or length(target_progress->>'preview') > 48000
    or jsonb_typeof(target_progress->'updatedAt') <> 'string'
    or length(target_progress->>'updatedAt') > 50 then
    raise exception 'AI_PROGRESS_INVALID';
  end if;
  update private.ai_generation_jobs
  set progress = target_progress
  where id = target_job_id and status = 'generating'
    and attempt_count = target_attempt_count;
  return found;
end;
$$;
revoke all on function public.report_ai_generation_progress(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.report_ai_generation_progress(uuid, integer, jsonb) to service_role;
