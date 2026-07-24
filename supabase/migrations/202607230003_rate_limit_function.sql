create or replace function public.consume_auth_rate_limit(
  target_bucket bytea,
  target_action text,
  target_max_attempts integer,
  target_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.auth_rate_limits%rowtype;
  current_time timestamptz := now();
  window_end timestamptz;
begin
  select *
  into current_row
  from private.auth_rate_limits
  where bucket_digest = target_bucket and action = target_action
  for update;

  if not found then
    insert into private.auth_rate_limits (
      bucket_digest, action, window_started_at, attempt_count
    )
    values (target_bucket, target_action, current_time, 1);
    return query select true, 0;
    return;
  end if;

  window_end := current_row.window_started_at
    + make_interval(secs => target_window_seconds);

  if current_time >= window_end then
    update private.auth_rate_limits
    set window_started_at = current_time,
        attempt_count = 1,
        blocked_until = null
    where bucket_digest = target_bucket and action = target_action;
    return query select true, 0;
    return;
  end if;

  if current_row.attempt_count >= target_max_attempts then
    update private.auth_rate_limits
    set blocked_until = window_end
    where bucket_digest = target_bucket and action = target_action;
    return query
      select false, greatest(1, ceil(extract(epoch from (window_end - current_time)))::integer);
    return;
  end if;

  update private.auth_rate_limits
  set attempt_count = attempt_count + 1
  where bucket_digest = target_bucket and action = target_action;
  return query select true, 0;
end;
$$;

revoke all on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  to service_role;
