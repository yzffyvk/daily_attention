begin;
select plan(46);

select has_schema('private', 'private schema exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'check_ins', 'check_ins exists');
select has_table('private', 'account_recovery_credentials', 'account recovery credentials exist');
select hasnt_table('private', 'login_aliases', 'legacy login aliases are removed');
select has_table('private', 'auth_rate_limits', 'rate-limit buckets exist');
select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_is_pk(
  'private',
  'account_recovery_credentials',
  'user_id',
  'account_recovery_credentials.user_id is the primary key'
);
select has_column('public', 'profiles', 'email', 'profiles have an email');
select col_not_null('public', 'profiles', 'email', 'email is required');
select col_is_unique('public', 'profiles', 'email', 'email is unique');
select col_type_is('public', 'profiles', 'email', 'character varying(254)', 'email has a 254-character maximum');
select hasnt_column('public', 'profiles', 'phone', 'profiles no longer have a phone');
select hasnt_function('public', 'resolve_phone', array['text'], 'resolve_phone no longer exists');
select has_function(
  'public',
  'resolve_recovery_challenge',
  array['text'],
  'fixed-shape recovery challenge function exists'
);
select is(
  (
    select setting
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.unnest(procedure.proconfig) as config(setting)
    where namespace.nspname = 'public'
      and procedure.proname = 'resolve_recovery_challenge'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'text'
      and setting = 'search_path=""'
  ),
  'search_path=""',
  'recovery challenge has an empty search path'
);
select function_returns(
  'public',
  'complete_registration',
  array['uuid', 'text', 'smallint', 'bytea'],
  'public.profiles'
);
select function_returns(
  'public',
  'read_profile',
  array['uuid'],
  'public.profiles'
);
select has_column('public', 'check_ins', 'version', 'check-ins have a version');
select has_index('public', 'check_ins', 'check_ins_user_date_key', 'one record per user and date');
select ok(exists (
  select 1
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'profiles'
    and c.conname = 'profiles_avatar_key_check'
    and c.contype = 'c'
), 'avatar is constrained');
select ok(exists (
  select 1
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'check_ins'
    and c.conname = 'check_ins_attention_check'
    and c.contype = 'c'
), 'attention is not blank');
select ok(exists (
  select 1
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'check_ins'
    and c.conname = 'check_ins_source_url_check'
    and c.contype = 'c'
), 'source URL is constrained');
select is(
  (
    select pg_get_constraintdef(c.oid, true)
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'check_ins'
      and c.conname = 'check_ins_image_path_check'
      and c.contype = 'c'
  ),
  'CHECK (image_path IS NULL OR length(image_path) <= 1024 AND split_part(image_path, ''/''::text, 1) = user_id::text AND image_path ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$''::text)',
  'image paths require the owner UUID, date, generated UUID filename, supported extension, and 1024-character maximum'
);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000203'),
  ('00000000-0000-0000-0000-000000000204'),
  ('00000000-0000-0000-0000-000000000205'),
  ('00000000-0000-0000-0000-000000000206');

select throws_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000201', 'schema-test@example.com', 'Schema test', 0)$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_avatar_key_check"',
  'profiles reject avatar keys outside 1-5'
);
select throws_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000201', 'schema-test@example.com', 'Schema test', 6)$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_avatar_key_check"',
  'profiles reject avatar keys above 5'
);
select throws_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000202', 'Uppercase@example.com', 'Schema test', 1)$$,
  '23514',
  null,
  'profiles reject uppercase emails'
);
select throws_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000203', 'not-an-email', 'Schema test', 1)$$,
  '23514',
  null,
  'profiles reject malformed emails'
);
select throws_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000204', repeat('a', 244) || '@example.com', 'Schema test', 1)$$,
  '22001',
  null,
  'profiles reject emails longer than 254 characters'
);
select lives_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000205', 'duplicate@example.com', 'Schema test', 1)$$,
  'profiles accept a valid lowercase email'
);
select throws_ok(
  $$insert into public.profiles (id, email, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000206', 'duplicate@example.com', 'Schema test', 1)$$,
  '23505',
  null,
  'profiles reject duplicate emails'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-24', '   ')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_attention_check"',
  'check-ins reject blank attention'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, source_url)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-25', 'Valid attention', 'ftp://example.com')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_source_url_check"',
  'check-ins reject non-HTTP source URLs'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-26', 'Valid attention', repeat('x', 1025))$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject image paths longer than 1024 characters'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-27', 'Valid attention', '')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject empty image paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-28', 'Valid attention', '   ')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject whitespace-only image paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-31', 'Valid attention', E'\t')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject tab-only image paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-08-01', 'Valid attention', E'\n')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject newline-only image paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-08-02', 'Valid attention', U&'\FEFF')$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject FEFF-only image paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values (
      '00000000-0000-0000-0000-000000000201',
      '2026-08-03',
      'Valid attention',
      '00000000-0000-0000-0000-000000000202/2026-08-03/00000000-0000-0000-0000-000000000203.jpg'
    )$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject foreign-owner image paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values (
      '00000000-0000-0000-0000-000000000201',
      '2026-08-04',
      'Valid attention',
      '00000000-0000-0000-0000-000000000201/2026-8-4/00000000-0000-0000-0000-000000000203.jpg'
    )$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject malformed dates and paths'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values (
      '00000000-0000-0000-0000-000000000201',
      '2026-08-05',
      'Valid attention',
      '00000000-0000-0000-0000-000000000201/2026-08-05/00000000-0000-0000-0000-000000000203.gif'
    )$$,
  '23514',
  'new row for relation "check_ins" violates check constraint "check_ins_image_path_check"',
  'check-ins reject unsupported image extensions'
);
select lives_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values ('00000000-0000-0000-0000-000000000201', '2026-07-29', 'Valid attention', null)$$,
  'check-ins allow NULL image paths'
);
select lives_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values (
      '00000000-0000-0000-0000-000000000201',
      '2026-07-30',
      'Valid attention',
      '00000000-0000-0000-0000-000000000201/2026-07-30/00000000-0000-0000-0000-000000000203.jpg'
    )$$,
  'check-ins allow generated-style JPEG owner paths'
);
select lives_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values (
      '00000000-0000-0000-0000-000000000201',
      '2026-07-31',
      'Valid attention',
      '00000000-0000-0000-0000-000000000201/2026-07-31/00000000-0000-0000-0000-000000000204.png'
    )$$,
  'check-ins allow generated-style PNG owner paths'
);
select lives_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention, image_path)
    values (
      '00000000-0000-0000-0000-000000000201',
      '2026-08-01',
      'Valid attention',
      '00000000-0000-0000-0000-000000000201/2026-08-01/00000000-0000-0000-0000-000000000205.webp'
    )$$,
  'check-ins allow generated-style WebP owner paths'
);

select * from finish();
rollback;
