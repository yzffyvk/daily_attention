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
  request_time timestamptz := pg_catalog.now();
  window_end timestamptz;
begin
  if target_bucket is null
    or pg_catalog.octet_length(target_bucket) <> 32
    or target_action is null
    or target_max_attempts is null
    or target_window_seconds is null
    or target_max_attempts <= 0
    or target_window_seconds <= 0
    or not (
      (target_action = 'register' and target_max_attempts = 5 and target_window_seconds = 3600)
      or (target_action = 'login' and target_max_attempts = 10 and target_window_seconds = 900)
      or (target_action = 'recover' and target_max_attempts = 5 and target_window_seconds = 1800)
      or (target_action = 'rotate' and target_max_attempts = 5 and target_window_seconds = 3600)
      or (target_action = 'ai_generate' and target_max_attempts = 10 and target_window_seconds = 600)
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid auth rate limit parameters';
  end if;

  insert into private.auth_rate_limits (
    bucket_digest,
    action,
    window_started_at,
    attempt_count
  )
  values (target_bucket, target_action, request_time, 1)
  on conflict (bucket_digest, action) do nothing;

  if found then
    return query select true, 0;
    return;
  end if;

  select limits.*
  into current_row
  from private.auth_rate_limits limits
  where limits.bucket_digest = target_bucket
    and limits.action = target_action
  for update;

  window_end := current_row.window_started_at
    + pg_catalog.make_interval(secs => target_window_seconds);

  if request_time >= window_end then
    update private.auth_rate_limits limits
    set window_started_at = request_time,
        attempt_count = 1,
        blocked_until = null
    where limits.bucket_digest = target_bucket
      and limits.action = target_action;
    return query select true, 0;
    return;
  end if;

  if current_row.attempt_count >= target_max_attempts then
    update private.auth_rate_limits limits
    set blocked_until = window_end
    where limits.bucket_digest = target_bucket
      and limits.action = target_action;
    return query
    select
      false,
      greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from (window_end - request_time))
        )::integer
      );
    return;
  end if;

  update private.auth_rate_limits limits
  set attempt_count = limits.attempt_count + 1
  where limits.bucket_digest = target_bucket
    and limits.action = target_action;
  return query select true, 0;
end;
$$;

revoke all on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  to service_role;
