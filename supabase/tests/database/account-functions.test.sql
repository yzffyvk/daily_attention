begin;
select plan(47);

select function_privs_are(
  'public',
  'complete_registration',
  array['uuid', 'text', 'smallint', 'bytea'],
  'anon',
  array[]::text[],
  'anon cannot complete registration'
);
select function_privs_are(
  'public',
  'resolve_phone',
  array['text'],
  'anon',
  array[]::text[],
  'anon cannot resolve phone numbers'
);
select function_privs_are(
  'public',
  'read_recovery_digest',
  array['uuid'],
  'anon',
  array[]::text[],
  'anon cannot read private recovery digests'
);
select function_privs_are(
  'public',
  'replace_recovery_digest',
  array['uuid', 'bytea', 'bytea'],
  'anon',
  array[]::text[],
  'anon cannot rotate private recovery digests'
);
select function_privs_are(
  'public',
  'update_profile',
  array['uuid', 'text', 'smallint'],
  'anon',
  array[]::text[],
  'anon cannot update profiles through the service RPC'
);
select function_privs_are(
  'public',
  'complete_registration',
  array['uuid', 'text', 'smallint', 'bytea'],
  'authenticated',
  array[]::text[],
  'authenticated cannot complete registration'
);
select function_privs_are(
  'public',
  'resolve_phone',
  array['text'],
  'authenticated',
  array[]::text[],
  'authenticated cannot resolve phone numbers'
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
  'replace_recovery_digest',
  array['uuid', 'bytea', 'bytea'],
  'authenticated',
  array[]::text[],
  'authenticated cannot rotate private recovery digests'
);
select function_privs_are(
  'public',
  'update_profile',
  array['uuid', 'text', 'smallint'],
  'authenticated',
  array[]::text[],
  'authenticated cannot update profiles through the service RPC'
);
select table_privs_are(
  'private',
  'account_recovery_credentials',
  'anon',
  array[]::text[],
  'private recovery credentials stay private from anon'
);
select table_privs_are(
  'private',
  'account_recovery_credentials',
  'authenticated',
  array[]::text[],
  'private recovery credentials stay private from authenticated'
);
select table_privs_are(
  'private',
  'auth_rate_limits',
  'authenticated',
  array[]::text[],
  'rate limits stay private'
);

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
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lifecycle-one@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'private-seed@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'private-anon@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'private-authenticated@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lifecycle-two@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invalid-phone@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duplicate-phone@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sequence-limit@internal.invalid', '', now(), now(), now());

insert into private.account_recovery_credentials (user_id, recovery_code_digest)
values (
  '00000000-0000-4000-8000-000000000004',
  decode('01020304', 'hex')
);

insert into private.auth_rate_limits (bucket_digest, action, window_started_at, attempt_count)
values (decode('aabbccdd', 'hex'), 'login', now(), 1);

set local role anon;
select throws_ok(
  $$select user_id from private.account_recovery_credentials
    where user_id = '00000000-0000-4000-8000-000000000004'$$,
  '42501',
  'permission denied for schema private',
  'anon cannot select private recovery credentials'
);
select throws_ok(
  $$insert into private.account_recovery_credentials (user_id, recovery_code_digest)
    values ('00000000-0000-4000-8000-000000000005', decode('05060708', 'hex'))$$,
  '42501',
  'permission denied for schema private',
  'anon cannot insert private recovery credentials'
);
select throws_ok(
  $$select bucket_digest from private.auth_rate_limits where action = 'login'$$,
  '42501',
  'permission denied for schema private',
  'anon cannot select private auth rate limits'
);
select throws_ok(
  $$insert into private.auth_rate_limits (bucket_digest, action, window_started_at, attempt_count)
    values (decode('11223344', 'hex'), 'register', now(), 1)$$,
  '42501',
  'permission denied for schema private',
  'anon cannot insert private auth rate limits'
);

set local role authenticated;
select throws_ok(
  $$select user_id from private.account_recovery_credentials
    where user_id = '00000000-0000-4000-8000-000000000004'$$,
  '42501',
  'permission denied for schema private',
  'authenticated cannot select private recovery credentials'
);
select throws_ok(
  $$insert into private.account_recovery_credentials (user_id, recovery_code_digest)
    values ('00000000-0000-4000-8000-000000000006', decode('090a0b0c', 'hex'))$$,
  '42501',
  'permission denied for schema private',
  'authenticated cannot insert private recovery credentials'
);
select throws_ok(
  $$select bucket_digest from private.auth_rate_limits where action = 'login'$$,
  '42501',
  'permission denied for schema private',
  'authenticated cannot select private auth rate limits'
);
select throws_ok(
  $$insert into private.auth_rate_limits (bucket_digest, action, window_started_at, attempt_count)
    values (decode('55667788', 'hex'), 'register', now(), 1)$$,
  '42501',
  'permission denied for schema private',
  'authenticated cannot insert private auth rate limits'
);

set local role anon;
select throws_ok(
  $$select public.complete_registration(
      '00000000-0000-4000-8000-000000000003'::uuid,
      '13800138000'::text,
      3::smallint,
      decode('01020304', 'hex')
    )$$,
  '42501',
  'permission denied for function complete_registration',
  'anon cannot call registration'
);
select throws_ok(
  $$select * from public.resolve_phone('13800138000')$$,
  '42501',
  'permission denied for function resolve_phone',
  'anon cannot resolve phone numbers'
);
select throws_ok(
  $$select public.read_recovery_digest('00000000-0000-4000-8000-000000000003')$$,
  '42501',
  'permission denied for function read_recovery_digest',
  'anon cannot read recovery digests'
);
select throws_ok(
  $$select public.replace_recovery_digest(
      '00000000-0000-4000-8000-000000000003',
      decode('01020304', 'hex'),
      decode('05060708', 'hex')
    )$$,
  '42501',
  'permission denied for function replace_recovery_digest',
  'anon cannot replace recovery digests'
);
select throws_ok(
  $$select public.update_profile(
      '00000000-0000-4000-8000-000000000003'::uuid,
      'Renamed'::text,
      4::smallint
    )$$,
  '42501',
  'permission denied for function update_profile',
  'anon cannot update profiles'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.complete_registration(
      '00000000-0000-4000-8000-000000000003'::uuid,
      '13800138000'::text,
      3::smallint,
      decode('01020304', 'hex')
    )$$,
  '42501',
  'permission denied for function complete_registration',
  'authenticated cannot call registration'
);
select throws_ok(
  $$select * from public.resolve_phone('13800138000')$$,
  '42501',
  'permission denied for function resolve_phone',
  'authenticated cannot resolve phone numbers'
);
select throws_ok(
  $$select public.read_recovery_digest('00000000-0000-4000-8000-000000000003')$$,
  '42501',
  'permission denied for function read_recovery_digest',
  'authenticated cannot read recovery digests'
);
select throws_ok(
  $$select public.replace_recovery_digest(
      '00000000-0000-4000-8000-000000000003',
      decode('01020304', 'hex'),
      decode('05060708', 'hex')
    )$$,
  '42501',
  'permission denied for function replace_recovery_digest',
  'authenticated cannot replace recovery digests'
);
select throws_ok(
  $$select public.update_profile(
      '00000000-0000-4000-8000-000000000003'::uuid,
      'Renamed'::text,
      4::smallint
    )$$,
  '42501',
  'permission denied for function update_profile',
  'authenticated cannot update profiles'
);

reset role;
select setval('private.attention_display_name_seq', 1, false);
set local role service_role;

select results_eq(
  $$select phone, display_name, avatar_key
    from public.complete_registration(
      '00000000-0000-4000-8000-000000000003',
      '13800138000',
      3::smallint,
      decode('01020304', 'hex')
    )$$,
  $$values ('13800138000'::varchar, 'Attention_001'::varchar, 3::smallint)$$,
  'first registration receives the first global default name'
);
select results_eq(
  $$select phone, display_name, avatar_key
    from public.complete_registration(
      '00000000-0000-4000-8000-000000000007',
      '13900139000',
      2::smallint,
      decode('11121314', 'hex')
    )$$,
  $$values ('13900139000'::varchar, 'Attention_002'::varchar, 2::smallint)$$,
  'second registration in the transaction receives the next global default name'
);
select results_eq(
  $$select * from public.resolve_phone('13800138000')$$,
  $$values ('00000000-0000-4000-8000-000000000003'::uuid)$$,
  'service role resolves a registered phone'
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
  'a stale recovery digest replacement leaves the digest unchanged'
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
  $$select phone, display_name, avatar_key
    from public.update_profile(
      '00000000-0000-4000-8000-000000000003',
      'Renamed',
      4::smallint
    )$$,
  $$values ('13800138000'::varchar, 'Renamed'::varchar, 4::smallint)$$,
  'service role updates and returns the profile without changing its phone'
);
select results_eq(
  $$select * from public.resolve_phone('13800138000')$$,
  $$values ('00000000-0000-4000-8000-000000000003'::uuid)$$,
  'profile updates preserve phone resolution'
);
select results_eq(
  $$select * from public.resolve_phone('13900139000')$$,
  $$values ('00000000-0000-4000-8000-000000000007'::uuid)$$,
  'the second registration has its own phone mapping'
);
select throws_ok(
  $$select public.complete_registration(
      '00000000-0000-4000-8000-000000000008',
      '12800138000',
      3::smallint,
      decode('21222324', 'hex')
    )$$,
  '23514',
  null,
  'registration rejects an invalid phone'
);
select is_empty(
  $$select * from public.resolve_phone('12800138000')$$,
  'invalid registration does not leave a profile behind'
);
select throws_ok(
  $$select public.complete_registration(
      '00000000-0000-4000-8000-000000000009',
      '13800138000',
      3::smallint,
      decode('31323334', 'hex')
    )$$,
  '23505',
  null,
  'registration rejects a duplicate phone'
);
select is(
  public.read_recovery_digest('00000000-0000-4000-8000-000000000009'),
  null,
  'duplicate registration does not leave recovery credentials behind'
);
reset role;
select setval('private.attention_display_name_seq', 999, true);
set local role service_role;
select throws_ok(
  $$select public.complete_registration(
      '00000000-0000-4000-8000-000000000010',
      '13700137000',
      3::smallint,
      decode('41424344', 'hex')
    )$$,
  '2200H',
  'nextval: reached maximum value of sequence "attention_display_name_seq" (999)',
  'registration rejects default-name values over 999'
);
reset role;
select setval('private.attention_display_name_seq', 1, false);

select * from finish();
rollback;
