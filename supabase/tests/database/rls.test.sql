begin;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@internal.invalid', '', now(), now(), now());

insert into public.profiles (id, email, display_name, avatar_key)
values
  ('00000000-0000-4000-8000-000000000001', 'one@example.com', '用户一', 1),
  ('00000000-0000-4000-8000-000000000002', 'two@example.com', '用户二', 2);

insert into public.check_ins (user_id, checkin_date, attention)
values
  ('00000000-0000-4000-8000-000000000001', '2026-07-23', 'one'),
  ('00000000-0000-4000-8000-000000000002', '2026-07-23', 'two');

select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'checkin-images'
      and owner_id in (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'
      )
  ),
  0,
  'storage starts without these test users'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('other-images', 'other-images', false, 10485760, array['image/png']);

insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values
  (
    'checkin-images',
    '00000000-0000-4000-8000-000000000001/own.png',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '{"size":1,"mimetype":"image/png"}'::jsonb
  ),
  (
    'checkin-images',
    '00000000-0000-4000-8000-000000000002/other.png',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '{"size":1,"mimetype":"image/png"}'::jsonb
  ),
  (
    'other-images',
    '00000000-0000-4000-8000-000000000001/wrong-bucket.png',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '{"size":1,"mimetype":"image/png"}'::jsonb
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$select email, display_name from public.profiles order by display_name$$,
  $$values ('one@example.com'::varchar, '用户一'::varchar)$$,
  'user sees only their email and profile'
);
select throws_ok(
  $$update public.profiles set email = 'changed@example.com'$$,
  '42501',
  null,
  'user cannot modify their email'
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
select throws_ok(
  $$update public.check_ins
    set user_id = '00000000-0000-4000-8000-000000000002'
    where user_id = '00000000-0000-4000-8000-000000000001'
      and checkin_date = '2026-07-23'$$,
  '42501',
  'new row violates row-level security policy for table "check_ins"',
  'user cannot reassign their own check-in to another user'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values (
      'checkin-images',
      '00000000-0000-4000-8000-000000000001/new-own.png',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '{"size":1,"mimetype":"image/png"}'::jsonb
    )$$,
  '42501',
  null,
  'user cannot directly insert even in their own storage path'
);
select results_eq(
  $$select bucket_id, name, owner, owner_id, metadata
    from storage.objects
    where bucket_id = 'checkin-images'
    order by name$$,
  $$values (
    'checkin-images'::text,
    '00000000-0000-4000-8000-000000000001/own.png'::text,
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000001'::text,
    '{"size":1,"mimetype":"image/png"}'::jsonb
  )$$,
  'user sees only their valid storage object'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values (
      'checkin-images',
      '00000000-0000-4000-8000-000000000002/forged.png',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '{"size":1,"mimetype":"image/png"}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user cannot insert a storage object in another user path'
);
select is_empty(
  $$select id from storage.objects where bucket_id = 'other-images'$$,
  'user cannot see objects in another bucket'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values (
      'other-images',
      '00000000-0000-4000-8000-000000000001/forged.png',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '{"size":1,"mimetype":"image/png"}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'user cannot insert a storage object in another bucket'
);
select set_config('storage.allow_delete_query', 'true', true);
select results_eq(
  $$delete from storage.objects
    where bucket_id = 'checkin-images'
      and name = '00000000-0000-4000-8000-000000000001/own.png'
    returning name$$,
  $$values ('00000000-0000-4000-8000-000000000001/own.png'::text)$$,
  'user can delete their own storage object'
);
select is_empty(
  $$delete from storage.objects
    where bucket_id = 'checkin-images'
      and name = '00000000-0000-4000-8000-000000000002/other.png'
    returning id$$,
  'user cannot delete another user storage object'
);
select has_table('private', 'account_recovery_credentials', 'private recovery credentials exist');
select hasnt_table('private', 'login_aliases', 'legacy private mapping is removed');
select schema_privs_are('private', 'authenticated', array[]::text[], 'authenticated has no private schema privileges');

reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shadow@internal.invalid', '', now(), now(), now());
insert into public.check_ins (user_id, checkin_date, attention)
values ('00000000-0000-4000-8000-000000000003', '2026-07-23', 'shadow');
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values (
  'checkin-images',
  '00000000-0000-4000-8000-000000000003/shadow.png',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000003',
  '{"size":1,"mimetype":"image/png"}'::jsonb
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select is_empty(
  $$select id from public.check_ins$$,
  'an authenticated user without a profile cannot read check-ins'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention)
    values ('00000000-0000-4000-8000-000000000003', '2026-07-24', 'shadow-write')$$,
  '42501',
  null,
  'an authenticated user without a profile cannot insert check-ins'
);
select is_empty(
  $$select id from storage.objects where bucket_id = 'checkin-images'$$,
  'an authenticated user without a profile cannot read Storage objects'
);
select is_empty(
  $$delete from storage.objects
    where bucket_id = 'checkin-images'
      and name = '00000000-0000-4000-8000-000000000003/shadow.png'
    returning id$$,
  'an authenticated user without a profile cannot delete Storage objects'
);

select * from finish();
rollback;
