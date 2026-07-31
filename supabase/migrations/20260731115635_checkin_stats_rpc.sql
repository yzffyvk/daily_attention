create function public.get_check_in_stats(target_today date)
returns table (
  total_count bigint,
  current_streak integer,
  has_today_record boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  owned_dates as materialized (
    select records.checkin_date
    from public.check_ins records
    where records.user_id = (select auth.uid())
      and records.checkin_date <= target_today
  ),
  anchor as (
    select case
      when exists (
        select 1
        from owned_dates
        where checkin_date = target_today
      ) then target_today
      else target_today - 1
    end as day
  ),
  streak(day, length) as (
    select anchor.day, 0
    from anchor

    union all

    select streak.day - 1, streak.length + 1
    from streak
    where exists (
      select 1
      from owned_dates
      where checkin_date = streak.day
    )
  )
  select
    (
      select pg_catalog.count(*)
      from public.check_ins records
      where records.user_id = (select auth.uid())
    )::bigint as total_count,
    coalesce((select pg_catalog.max(length) from streak), 0)::integer
      as current_streak,
    exists (
      select 1
      from owned_dates
      where checkin_date = target_today
    ) as has_today_record;
$$;

revoke all on function public.get_check_in_stats(date)
  from public, anon, authenticated;
grant execute on function public.get_check_in_stats(date) to authenticated;
