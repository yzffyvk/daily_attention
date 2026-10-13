begin;

-- Summary length is guided by prompts; preserve all other validation and permissions.
alter table public.check_ins drop constraint check_ins_summary_check;
alter table private.ai_generation_jobs drop constraint ai_generation_jobs_summary_check;

CREATE OR REPLACE FUNCTION public.complete_ai_generation_job(target_job_id uuid, target_succeeded boolean, target_attention text, target_summary text, target_inspiration text, target_source_title text, target_warnings jsonb, target_error_code text, target_error_message text, target_provider_call_count integer, target_prompt_tokens integer, target_prompt_cache_hit_tokens integer, target_prompt_cache_miss_tokens integer, target_completion_tokens integer, target_reasoning_tokens integer, target_model text, target_system_fingerprint text, target_content_digest bytea)
 RETURNS SETOF public.ai_generation_job_record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

commit;

