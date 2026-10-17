-- Settle only terminal quality failures that produced no usable summary.
-- The job transition and refund share one transaction and the existing row lock.
create function private.refund_ai_generation_quality_failure()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update private.ai_daily_quotas
  set consumed_count = consumed_count - 1
  where user_id = old.user_id and quota_date = old.quota_date;
  new.error_message := '本次提炼未通过质量校验，未消耗使用次数，请重试。';
  return new;
end;
$$;
revoke all on function private.refund_ai_generation_quality_failure() from public, anon, authenticated, service_role;

create trigger ai_generation_jobs_refund_quality_failure
before update of status on private.ai_generation_jobs
for each row
when (old.status in ('fetching', 'generating', 'retryable') and new.status = 'failed'
  and new.error_code = 'MODEL_OUTPUT_INVALID' and new.summary is null and old.started_at is not null)
execute function private.refund_ai_generation_quality_failure();
