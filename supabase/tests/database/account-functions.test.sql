begin;
select plan(7);

select function_privs_are(
  'public',
  'complete_registration',
  array['uuid', 'text', 'text', 'smallint', 'bytea'],
  'authenticated',
  array[]::text[],
  'authenticated cannot complete registration'
);
select function_privs_are(
  'public',
  'resolve_login_name',
  array['text'],
  'authenticated',
  array[]::text[],
  'authenticated cannot resolve private emails'
);
select function_privs_are(
  'public',
  'read_recovery_digest',
  array['uuid'],
  'authenticated',
  array[]::text[],
  'authenticated cannot read private recovery digests'
);
select function_privs_are(
  'public',
  'update_profile_identity',
  array['uuid', 'text', 'smallint'],
  'authenticated',
  array[]::text[],
  'authenticated cannot directly mutate private aliases'
);
select function_privs_are(
  'public',
  'replace_recovery_digest',
  array['uuid', 'bytea', 'bytea'],
  'authenticated',
  array[]::text[],
  'authenticated cannot rotate private digests directly'
);
select table_privs_are('private', 'login_aliases', 'authenticated', array[]::text[], 'private aliases stay private');
select table_privs_are('private', 'auth_rate_limits', 'authenticated', array[]::text[], 'rate limits stay private');

select * from finish();
rollback;
