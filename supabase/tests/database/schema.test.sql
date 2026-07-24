begin;
select plan(12);

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

select * from finish();
rollback;
