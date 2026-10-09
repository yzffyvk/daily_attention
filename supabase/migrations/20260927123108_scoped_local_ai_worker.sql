begin;
-- Lease only the selected account's deliveries. Filtering after pgmq.read would
-- hide other users' messages; use the same row-lock/visibility semantics here.
create function public.read_owned_ai_generation_queue(
  target_user_id uuid,
  target_created_after timestamptz,
  target_visibility_timeout integer,
  target_batch_limit integer
)
returns table (msg_id bigint, read_count integer, message jsonb, user_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null or target_created_after is null
    or not pg_catalog.isfinite(target_created_after)
    or target_visibility_timeout is null or target_visibility_timeout < 30 or target_visibility_timeout > 900
    or target_batch_limit is null or target_batch_limit < 1 or target_batch_limit > 2 then
    raise exception using errcode = '22023', message = 'invalid scoped AI queue parameters';
  end if;
  return query
  with selected as (
    select delivery.msg_id
    from pgmq.q_ai_generation_jobs delivery
    join private.ai_generation_jobs jobs on jobs.id::text = delivery.message->>'job_id'
    where jobs.user_id = target_user_id and jobs.created_at >= target_created_after
      and delivery.vt <= pg_catalog.clock_timestamp()
    order by delivery.msg_id
    limit target_batch_limit
    for update of delivery skip locked
  ), leased as (
    update pgmq.q_ai_generation_jobs delivery
    set vt = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => target_visibility_timeout),
        read_ct = delivery.read_ct + 1
    from selected
    where delivery.msg_id = selected.msg_id
    returning delivery.msg_id, delivery.read_ct, delivery.message
  )
  select leased.msg_id, leased.read_ct, leased.message, jobs.user_id, jobs.created_at
  from leased join private.ai_generation_jobs jobs on jobs.id::text = leased.message->>'job_id';
end;
$$;
revoke all on function public.read_owned_ai_generation_queue(uuid, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.read_owned_ai_generation_queue(uuid, timestamptz, integer, integer) to service_role;
comment on function public.read_owned_ai_generation_queue(uuid, timestamptz, integer, integer) is
  'Service-only local acceptance queue lease, explicitly bounded by account and creation time; no narrative consumption.';
commit;
