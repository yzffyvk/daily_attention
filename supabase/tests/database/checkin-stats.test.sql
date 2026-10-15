begin;
select plan(12);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'stats-one@internal.invalid',
    '',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'stats-two@internal.invalid',
    '',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'stats-empty@internal.invalid',
    '',
    now(),
    now(),
    now()
  );

insert into public.profiles (id, email, display_name, avatar_key)
values
  (
    '00000000-0000-4000-8000-000000000701',
    'stats-one@example.com',
    '统计用户一',
    1
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    'stats-two@example.com',
    '统计用户二',
    2
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    'stats-empty@example.com',
    '统计空用户',
    3
  );

insert into public.check_ins (user_id, checkin_date, attention)
values
  ('00000000-0000-4000-8000-000000000701', '2025-12-20', 'older'),
  ('00000000-0000-4000-8000-000000000701', '2026-06-29', 'day one'),
  ('00000000-0000-4000-8000-000000000701', '2026-06-30', 'day two'),
  ('00000000-0000-4000-8000-000000000701', '2026-07-01', 'day three'),
  ('00000000-0000-4000-8000-000000000701', '2026-07-10', 'future'),
  ('00000000-0000-4000-8000-000000000702', '2026-07-01', 'isolated today'),
  ('00000000-0000-4000-8000-000000000702', '2026-07-10', 'isolated future');

select has_function(
  'public',
  'get_check_in_stats',
  array['date'],
  'check-in statistics function exists'
);

select is(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'get_check_in_stats'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'date'
  ),
  false,
  'check-in statistics run as security invoker'
);

select is(
  (
    select setting
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.unnest(procedure.proconfig) as config(setting)
    where namespace.nspname = 'public'
      and procedure.proname = 'get_check_in_stats'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'date'
      and setting = 'search_path=""'
  ),
  'search_path=""',
  'check-in statistics have an empty search path'
);

select function_privs_are(
  'public',
  'get_check_in_stats',
  array['date'],
  'public',
  array[]::text[],
  'public cannot execute check-in statistics'
);

select function_privs_are(
  'public',
  'get_check_in_stats',
  array['date'],
  'anon',
  array[]::text[],
  'anonymous users cannot execute check-in statistics'
);

select function_privs_are(
  'public',
  'get_check_in_stats',
  array['date'],
  'authenticated',
  array['EXECUTE'],
  'authenticated users can execute their own statistics'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000701","role":"authenticated"}',
  true
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-01'::date)$$,
  $$values (4::bigint, 3, true)$$,
  'statistics count completed dates up to the requested date across month boundaries'
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-02'::date)$$,
  $$values (4::bigint, 3, false)$$,
  'a missing today continues the streak from yesterday'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000703","role":"authenticated"}',
  true
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-01'::date)$$,
  $$values (0::bigint, 0, false)$$,
  'an empty history returns zero statistics'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000702","role":"authenticated"}',
  true
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-01'::date)$$,
  $$values (1::bigint, 1, true)$$,
  'a single current day produces a one-day streak'
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-09'::date)$$,
  $$values (1::bigint, 0, false)$$,
  'future records do not start the current streak'
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2025-12-20'::date)$$,
  $$values (0::bigint, 0, false)$$,
  'statistics remain isolated from another user history'
);

select * from finish();
rollback;
