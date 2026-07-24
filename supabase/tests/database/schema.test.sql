begin;
select plan(17);

select has_schema('private', 'private schema exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'check_ins', 'check_ins exists');
select has_table('private', 'login_aliases', 'login aliases exists');
select has_table('private', 'auth_rate_limits', 'rate-limit buckets exist');
select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_is_pk('private', 'login_aliases', 'user_id', 'login_aliases.user_id is the primary key');
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

insert into auth.users (id)
values ('00000000-0000-0000-0000-000000000201');

select throws_ok(
  $$insert into public.profiles (id, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000201', 'Schema test', 0)$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_avatar_key_check"',
  'profiles reject avatar keys outside 1-5'
);
select throws_ok(
  $$insert into public.profiles (id, display_name, avatar_key)
    values ('00000000-0000-0000-0000-000000000201', 'Schema test', 6)$$,
  '23514',
  'new row for relation "profiles" violates check constraint "profiles_avatar_key_check"',
  'profiles reject avatar keys above 5'
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

select * from finish();
rollback;
