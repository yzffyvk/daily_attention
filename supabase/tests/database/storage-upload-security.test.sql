begin;
select plan(21);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'storage-limit-one@internal.invalid',
    '',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'storage-limit-two@internal.invalid',
    '',
    now(),
    now(),
    now()
  );

select policy_cmd_is(
  'storage',
  'objects',
  'checkin_images_insert_own',
  null,
  'the legacy authenticated insert policy is removed'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated"}',
  true
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
    values (
      'checkin-images',
      '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000303.png',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000301',
      '{"size":1024,"mimetype":"image/png"}'::jsonb
    )$$,
  '42501',
  null,
  'authenticated users cannot insert directly into check-in storage'
);
select throws_ok(
  $$select * from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000303.png',
    1024
  )$$,
  '42501',
  'permission denied for function reserve_checkin_image_upload',
  'authenticated users cannot reserve upload quota directly'
);

reset role;

select results_eq(
  $$select allowed, reason, retry_after_seconds
    from public.reserve_checkin_image_upload(
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000311.png',
      1024
    )$$,
  $$values (true, null::text, 0)$$,
  'the first server upload reservation is allowed'
);
select is(
  (
    select reserved_bytes
    from private.storage_upload_reservations
    where path = '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000311.png'
  ),
  10485760::bigint,
  'quota reserves the bucket maximum instead of trusting the claimed size'
);
select results_eq(
  $$select allowed from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000312.png',
    1024
  )$$,
  $$values (true)$$,
  'the second server upload reservation is allowed'
);
select results_eq(
  $$select allowed from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000313.png',
    1024
  )$$,
  $$values (true)$$,
  'the third server upload reservation is allowed'
);
select results_eq(
  $$select allowed from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000314.png',
    1024
  )$$,
  $$values (true)$$,
  'the fourth server upload reservation is allowed'
);
select results_eq(
  $$select allowed from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000315.png',
    1024
  )$$,
  $$values (true)$$,
  'the fifth server upload reservation is allowed'
);
select results_eq(
  $$select allowed, reason, retry_after_seconds > 0
    from public.reserve_checkin_image_upload(
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000316.png',
      1024
    )$$,
  $$values (false, 'RATE_LIMITED'::text, true)$$,
  'the sixth reservation inside ten minutes is rate limited'
);

select is(
  (
    select count(*)::integer
    from private.storage_upload_reservations
    where user_id = '00000000-0000-4000-8000-000000000301'
  ),
  5,
  'a rejected rate-limited request creates no reservation'
);

insert into private.storage_upload_reservations (
  path, user_id, reserved_bytes, expires_at
)
select
  '00000000-0000-4000-8000-000000000302/2026-07-25/'
    || lpad(to_hex(value), 8, '0')
    || '-0000-4000-8000-000000000000.png',
  '00000000-0000-4000-8000-000000000302',
  1024,
  now() + interval '2 hours'
from generate_series(1, 400) as value;

select results_eq(
  $$select allowed, reason, retry_after_seconds
    from public.reserve_checkin_image_upload(
      '00000000-0000-4000-8000-000000000302',
      '00000000-0000-4000-8000-000000000302/2026-07-25/00000000-0000-4000-8000-000000000399.png',
      1024
    )$$,
  $$values (false, 'STORAGE_QUOTA_EXCEEDED'::text, 0)$$,
  'the total object quota blocks additional upload reservations'
);

select is(
  (
    select count(*)::integer
    from private.storage_upload_reservations
    where user_id = '00000000-0000-4000-8000-000000000302'
  ),
  400,
  'a quota rejection creates no extra reservation'
);

delete from private.storage_upload_reservations
where user_id = '00000000-0000-4000-8000-000000000302';
insert into private.storage_upload_reservations (
  path, user_id, reserved_bytes, expires_at
)
select
  '00000000-0000-4000-8000-000000000302/2026-07-25/'
    || lpad(to_hex(value), 8, '0')
    || '-0000-4000-8000-000000000000.png',
  '00000000-0000-4000-8000-000000000302',
  10485760,
  now() + interval '2 hours'
from generate_series(1, 51) as value;
update private.storage_upload_limits
set window_started_at = now() - interval '11 minutes',
    attempt_count = 0
where user_id = '00000000-0000-4000-8000-000000000302';
select results_eq(
  $$select allowed, reason
    from public.reserve_checkin_image_upload(
      '00000000-0000-4000-8000-000000000302',
      '00000000-0000-4000-8000-000000000302/2026-07-25/00000000-0000-4000-8000-000000000398.png',
      1
    )$$,
  $$values (false, 'STORAGE_QUOTA_EXCEEDED'::text)$$,
  'quota reserves the full object maximum even when the client claims one byte'
);

select lives_ok(
  $$select public.release_checkin_image_upload_reservation(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000311.png'
  )$$,
  'the server can release a failed signed-upload reservation'
);
select is(
  (
    select count(*)::integer
    from private.storage_upload_reservations
    where user_id = '00000000-0000-4000-8000-000000000301'
  ),
  4,
  'release removes the matching owner reservation'
);

select throws_ok(
  $$select * from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000302/2026-07-25/00000000-0000-4000-8000-000000000320.png',
    1024
  )$$,
  '22023',
  'invalid storage upload reservation',
  'the quota function rejects a foreign-owner path'
);
select throws_ok(
  $$select * from public.reserve_checkin_image_upload(
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000301/2026-07-25/00000000-0000-4000-8000-000000000321.png',
    10485761
  )$$,
  '22023',
  'invalid storage upload reservation',
  'the quota function rejects files above the bucket limit'
);

select function_privs_are(
  'public',
  'reserve_checkin_image_upload',
  array['uuid', 'text', 'bigint'],
  'authenticated',
  array[]::text[],
  'authenticated has no upload reservation function privileges'
);
select function_privs_are(
  'public',
  'release_checkin_image_upload_reservation',
  array['uuid', 'text'],
  'authenticated',
  array[]::text[],
  'authenticated has no reservation release privileges'
);
select table_privs_are(
  'private',
  'storage_upload_reservations',
  'authenticated',
  array[]::text[],
  'authenticated cannot inspect or mutate upload reservations'
);

select * from finish();
rollback;
