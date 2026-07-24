begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@internal.invalid', '', now(), now(), now());

insert into public.profiles (id, display_name, avatar_key)
values
  ('00000000-0000-4000-8000-000000000001', '用户一', 1),
  ('00000000-0000-4000-8000-000000000002', '用户二', 2);

insert into public.check_ins (user_id, checkin_date, attention)
values
  ('00000000-0000-4000-8000-000000000001', '2026-07-23', 'one'),
  ('00000000-0000-4000-8000-000000000002', '2026-07-23', 'two');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$select display_name from public.profiles order by display_name$$,
  $$values ('用户一'::varchar)$$,
  'user sees only their profile'
);
select results_eq(
  $$select attention from public.check_ins$$,
  $$values ('one'::varchar)$$,
  'user sees only their check-in'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention)
    values ('00000000-0000-4000-8000-000000000002', '2026-07-24', 'forged')$$,
  '42501',
  null,
  'user cannot insert for another user'
);
select is_empty(
  $$update public.check_ins set attention = 'forged'
    where user_id = '00000000-0000-4000-8000-000000000002'
    returning id$$,
  'user cannot update another user'
);
select lives_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention)
    values ('00000000-0000-4000-8000-000000000001', '2026-07-24', 'mine')$$,
  'user can insert their own record'
);
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'checkin-images'),
  0,
  'storage starts empty'
);
select has_table('private', 'login_aliases', 'private mapping exists');
select schema_privs_are('private', 'authenticated', array[]::text[], 'authenticated has no private schema privileges');

select * from finish();
rollback;
