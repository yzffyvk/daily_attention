-- Cancellation settlement stays private and is independent of generation quota.
alter table private.ai_generation_jobs add column cancelled_without_quota boolean;

create table private.ai_cancel_daily_allowances (
  user_id uuid not null references auth.users(id) on delete cascade,
  cancellation_date date not null,
  used_count smallint not null default 0 check (used_count between 0 and 2),
  primary key (user_id, cancellation_date)
);
alter table private.ai_cancel_daily_allowances enable row level security;
revoke all on private.ai_cancel_daily_allowances from public, anon, authenticated, service_role;

create function private.ai_generation_job_state(current_job private.ai_generation_jobs)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
  reserved integer := 0;
  consumed integer := 0;
  free_used integer := 0;
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
      'consumed', consumed, 'limit', 5, 'remaining', 5 - reserved - consumed),
    'cancellation', pg_catalog.jsonb_build_object('freeRemaining', 2 - free_used,
      'requiresConfirmation', current_job.status in ('queued', 'fetching', 'generating', 'retryable')
        and current_job.started_at is not null and free_used >= 2,
      'charged', case when current_job.status = 'cancelled'
        then not coalesce(current_job.cancelled_without_quota, true) else null end)
  );
end;
$$;
revoke all on function private.ai_generation_job_state(private.ai_generation_jobs) from public, anon, authenticated, service_role;

create function public.read_ai_generation_job_state(target_user_id uuid, target_job_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ai_generation_job_state(jobs) from private.ai_generation_jobs jobs
  where jobs.id = target_job_id and jobs.user_id = target_user_id;
$$;

-- Workers poll just the status instead of downloading the streaming preview.
create function public.read_ai_generation_job_execution_status(target_job_id uuid)
returns text language sql security definer set search_path = '' as $$
  select jobs.status::text from private.ai_generation_jobs jobs where jobs.id = target_job_id;
$$;

create function public.cancel_ai_generation_job_v2(
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

revoke all on function public.read_ai_generation_job_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.read_ai_generation_job_execution_status(uuid) from public, anon, authenticated;
revoke all on function public.cancel_ai_generation_job_v2(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.read_ai_generation_job_state(uuid, uuid) to service_role;
grant execute on function public.read_ai_generation_job_execution_status(uuid) to service_role;
grant execute on function public.cancel_ai_generation_job_v2(uuid, uuid, boolean) to service_role;

notify pgrst, 'reload schema';
