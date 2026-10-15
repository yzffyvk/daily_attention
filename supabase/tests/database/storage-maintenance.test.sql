begin;
select plan(23);

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
values (
  '00000000-0000-4000-8000-000000000801',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'storage-maintenance@internal.invalid',
  '',
  now(),
  now(),
  now()
);

insert into public.profiles (id, email, display_name, avatar_key)
values (
  '00000000-0000-4000-8000-000000000801',
  'storage-maintenance@example.com',
  '存储维护用户',
  1
);

insert into private.storage_upload_reservations (
  path,
  user_id,
  reserved_bytes,
  created_at,
  expires_at
)
values
  (
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000891.png',
    '00000000-0000-4000-8000-000000000801',
    1024,
    '0001-01-01'::timestamptz,
    '0001-01-02'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000892.png',
    '00000000-0000-4000-8000-000000000801',
    1024,
    now(),
    now() + interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000893.png',
    '00000000-0000-4000-8000-000000000801',
    1024,
    now() - interval '2 hours',
    now() - interval '1 hour'
  );

insert into storage.buckets (id, name, public)
values ('maintenance-other-images', 'maintenance-other-images', false);

insert into storage.objects (
  bucket_id,
  name,
  owner,
  owner_id,
  created_at,
  updated_at,
  last_accessed_at,
  metadata
)
values
  (
    'checkin-images',
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000893.png',
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000801',
    now() - interval '1 hour',
    now() - interval '1 hour',
    now() - interval '1 hour',
    '{"size":1024,"mimetype":"image/png"}'::jsonb
  ),
  (
    'checkin-images',
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000894.png',
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000801',
    now() - interval '25 hours',
    now() - interval '25 hours',
    now() - interval '25 hours',
    '{"size":1024,"mimetype":"image/png"}'::jsonb
  ),
  (
    'checkin-images',
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000895.png',
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000801',
    now() - interval '23 hours',
    now() - interval '23 hours',
    now() - interval '23 hours',
    '{"size":1024,"mimetype":"image/png"}'::jsonb
  ),
  (
    'checkin-images',
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000899.png',
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000801',
    now() - interval '25 hours',
    now() - interval '25 hours',
    now() - interval '25 hours',
    '{"size":1024,"mimetype":"image/png"}'::jsonb
  ),
  (
    'maintenance-other-images',
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000898.png',
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000801',
    now() - interval '25 hours',
    now() - interval '25 hours',
    now() - interval '25 hours',
    '{"size":1024,"mimetype":"image/png"}'::jsonb
  );

insert into public.check_ins (
  user_id,
  checkin_date,
  attention,
  image_path,
  image_name
)
values (
  '00000000-0000-4000-8000-000000000801',
  '2026-07-01',
  'referenced image',
  '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000894.png',
  'referenced.png'
);

select has_function(
  'public',
  'delete_expired_storage_upload_reservations',
  array['integer'],
  'expired upload reservation cleanup function exists'
);

select has_function(
  'public',
  'list_orphan_checkin_image_paths',
  array['integer'],
  'orphan check-in image listing function exists'
);

select is(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'delete_expired_storage_upload_reservations'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'integer'
  ),
  true,
  'expired reservation cleanup is security definer'
);

select is(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'list_orphan_checkin_image_paths'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'integer'
  ),
  true,
  'orphan image listing is security definer'
);

select is(
  (
    select setting
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.unnest(procedure.proconfig) as config(setting)
    where namespace.nspname = 'public'
      and procedure.proname = 'delete_expired_storage_upload_reservations'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'integer'
      and setting = 'search_path=""'
  ),
  'search_path=""',
  'expired reservation cleanup has an empty search path'
);

select is(
  (
    select setting
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.unnest(procedure.proconfig) as config(setting)
    where namespace.nspname = 'public'
      and procedure.proname = 'list_orphan_checkin_image_paths'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'integer'
      and setting = 'search_path=""'
  ),
  'search_path=""',
  'orphan image listing has an empty search path'
);

select function_privs_are(
  'public',
  'delete_expired_storage_upload_reservations',
  array['integer'],
  'public',
  array[]::text[],
  'public cannot clean upload reservations'
);
select function_privs_are(
  'public',
  'delete_expired_storage_upload_reservations',
  array['integer'],
  'anon',
  array[]::text[],
  'anonymous users cannot clean upload reservations'
);
select function_privs_are(
  'public',
  'delete_expired_storage_upload_reservations',
  array['integer'],
  'authenticated',
  array[]::text[],
  'authenticated users cannot clean upload reservations'
);
select function_privs_are(
  'public',
  'delete_expired_storage_upload_reservations',
  array['integer'],
  'service_role',
  array['EXECUTE'],
  'service role can clean upload reservations'
);

select function_privs_are(
  'public',
  'list_orphan_checkin_image_paths',
  array['integer'],
  'public',
  array[]::text[],
  'public cannot list orphan images'
);
select function_privs_are(
  'public',
  'list_orphan_checkin_image_paths',
  array['integer'],
  'anon',
  array[]::text[],
  'anonymous users cannot list orphan images'
);
select function_privs_are(
  'public',
  'list_orphan_checkin_image_paths',
  array['integer'],
  'authenticated',
  array[]::text[],
  'authenticated users cannot list orphan images'
);
select function_privs_are(
  'public',
  'list_orphan_checkin_image_paths',
  array['integer'],
  'service_role',
  array['EXECUTE'],
  'service role can list orphan images'
);

create temporary table expected_reservation_cleanup as
select count(*)::integer as deleted_count from (
  select r.path from private.storage_upload_reservations r
  where r.expires_at<=now() and not exists(select 1 from storage.objects o where o.bucket_id='checkin-images' and o.name=r.path)
  order by r.expires_at,r.path limit 100
) due;
select is(
  public.delete_expired_storage_upload_reservations(100),
  (select deleted_count from expected_reservation_cleanup),
  'cleanup reports the eligible batch on a populated database'
);
select is((select count(*) from private.storage_upload_reservations
  where path='00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000891.png'),
  0::bigint, 'the fixture expired reservation without a stored object is deleted');

select results_eq(
  $$select path
    from public.list_orphan_checkin_image_paths(100)
    order by path$$,
  $$values (
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000899.png'
  )$$,
  'only old unreferenced check-in images are candidates'
);

select is(
  (
    select count(*)::integer
    from private.storage_upload_reservations
    where path = '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000892.png'
  ),
  1,
  'future upload reservations remain'
);

select is(
  (
    select count(*)::integer
    from private.storage_upload_reservations
    where path = '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000893.png'
  ),
  1,
  'expired reservations remain when their object exists'
);

select throws_ok(
  $$select public.delete_expired_storage_upload_reservations(0)$$,
  '22023',
  'target_limit must be between 1 and 500',
  'expired reservation cleanup rejects a zero limit'
);
select throws_ok(
  $$select public.delete_expired_storage_upload_reservations(501)$$,
  '22023',
  'target_limit must be between 1 and 500',
  'expired reservation cleanup rejects an oversized limit'
);
select throws_ok(
  $$select * from public.list_orphan_checkin_image_paths(0)$$,
  '22023',
  'target_limit must be between 1 and 500',
  'orphan image listing rejects a zero limit'
);
select throws_ok(
  $$select * from public.list_orphan_checkin_image_paths(501)$$,
  '22023',
  'target_limit must be between 1 and 500',
  'orphan image listing rejects an oversized limit'
);

select * from finish();
rollback;
