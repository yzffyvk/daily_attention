begin;
select plan(27);

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

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values (
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'lifecycle@internal.invalid',
  '',
  now(),
  now(),
  now()
);

set local role anon;
select throws_ok(
  $$select public.complete_registration('00000000-0000-4000-8000-000000000003'::uuid, 'Lifecycle'::text, 'lifecycle@internal.invalid'::text, 3::smallint, decode('01020304', 'hex'))$$,
  '42501',
  'permission denied for function complete_registration',
  'anon cannot complete registration'
);
select throws_ok(
  $$select * from public.resolve_login_name('Lifecycle')$$,
  '42501',
  'permission denied for function resolve_login_name',
  'anon cannot resolve login names'
);
select throws_ok(
  $$select public.read_recovery_digest('00000000-0000-4000-8000-000000000003')$$,
  '42501',
  'permission denied for function read_recovery_digest',
  'anon cannot read recovery digests'
);
select throws_ok(
  $$select public.replace_recovery_digest('00000000-0000-4000-8000-000000000003', decode('01020304', 'hex'), decode('05060708', 'hex'))$$,
  '42501',
  'permission denied for function replace_recovery_digest',
  'anon cannot replace recovery digests'
);
select throws_ok(
  $$select public.update_profile_identity('00000000-0000-4000-8000-000000000003'::uuid, 'Renamed'::text, 4::smallint)$$,
  '42501',
  'permission denied for function update_profile_identity',
  'anon cannot update profile identity'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.complete_registration('00000000-0000-4000-8000-000000000003'::uuid, 'Lifecycle'::text, 'lifecycle@internal.invalid'::text, 3::smallint, decode('01020304', 'hex'))$$,
  '42501',
  'permission denied for function complete_registration',
  'authenticated cannot complete registration'
);
select throws_ok(
  $$select * from public.resolve_login_name('Lifecycle')$$,
  '42501',
  'permission denied for function resolve_login_name',
  'authenticated cannot resolve login names'
);
select throws_ok(
  $$select public.read_recovery_digest('00000000-0000-4000-8000-000000000003')$$,
  '42501',
  'permission denied for function read_recovery_digest',
  'authenticated cannot read recovery digests'
);
select throws_ok(
  $$select public.replace_recovery_digest('00000000-0000-4000-8000-000000000003', decode('01020304', 'hex'), decode('05060708', 'hex'))$$,
  '42501',
  'permission denied for function replace_recovery_digest',
  'authenticated cannot replace recovery digests'
);
select throws_ok(
  $$select public.update_profile_identity('00000000-0000-4000-8000-000000000003'::uuid, 'Renamed'::text, 4::smallint)$$,
  '42501',
  'permission denied for function update_profile_identity',
  'authenticated cannot update profile identity'
);

set local role service_role;
select results_eq(
  $$select id, display_name, avatar_key
    from public.complete_registration(
      '00000000-0000-4000-8000-000000000003'::uuid,
      'Lifecycle'::text,
      'lifecycle@internal.invalid'::text,
      3::smallint,
      decode('01020304', 'hex')
    )$$,
  $$values ('00000000-0000-4000-8000-000000000003'::uuid, 'Lifecycle'::varchar, 3::smallint)$$,
  'service role registration creates and returns the profile'
);
select results_eq(
  $$select * from public.resolve_login_name('Lifecycle')$$,
  $$values ('00000000-0000-4000-8000-000000000003'::uuid, 'lifecycle@internal.invalid'::text)$$,
  'service role resolves the registered login mapping'
);
select is(
  encode(public.read_recovery_digest('00000000-0000-4000-8000-000000000003'), 'hex'),
  '01020304',
  'service role reads the registered recovery digest'
);
select is(
  public.replace_recovery_digest(
    '00000000-0000-4000-8000-000000000003',
    decode('ffffffff', 'hex'),
    decode('05060708', 'hex')
  ),
  false,
  'service role refuses a recovery digest replacement with a stale digest'
);
select is(
  encode(public.read_recovery_digest('00000000-0000-4000-8000-000000000003'), 'hex'),
  '01020304',
  'stale recovery digest replacement leaves the digest unchanged'
);
select is(
  public.replace_recovery_digest(
    '00000000-0000-4000-8000-000000000003',
    decode('01020304', 'hex'),
    decode('05060708', 'hex')
  ),
  true,
  'service role replaces a matching recovery digest'
);
select is(
  encode(public.read_recovery_digest('00000000-0000-4000-8000-000000000003'), 'hex'),
  '05060708',
  'service role reads the replacement recovery digest'
);
select results_eq(
  $$select id, display_name, avatar_key
    from public.update_profile_identity(
      '00000000-0000-4000-8000-000000000003'::uuid,
      'Renamed'::text,
      4::smallint
    )$$,
  $$values ('00000000-0000-4000-8000-000000000003'::uuid, 'Renamed'::varchar, 4::smallint)$$,
  'service role updates and returns profile identity'
);
select results_eq(
  $$select * from public.resolve_login_name('Renamed')$$,
  $$values ('00000000-0000-4000-8000-000000000003'::uuid, 'lifecycle@internal.invalid'::text)$$,
  'service role resolves the renamed login mapping'
);
select is_empty(
  $$select * from public.resolve_login_name('Lifecycle')$$,
  'old login name no longer resolves after the identity update'
);

select * from finish();
rollback;
