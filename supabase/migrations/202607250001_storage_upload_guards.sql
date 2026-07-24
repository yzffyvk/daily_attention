drop policy if exists checkin_images_insert_own on storage.objects;

drop policy if exists check_ins_select_own on public.check_ins;
create policy check_ins_select_own
on public.check_ins for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
);

drop policy if exists check_ins_insert_own on public.check_ins;
create policy check_ins_insert_own
on public.check_ins for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
);

drop policy if exists check_ins_update_own on public.check_ins;
create policy check_ins_update_own
on public.check_ins for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
);

drop policy if exists check_ins_delete_own on public.check_ins;
create policy check_ins_delete_own
on public.check_ins for delete to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
);

drop policy if exists checkin_images_select_own on storage.objects;
create policy checkin_images_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
);

drop policy if exists checkin_images_delete_own on storage.objects;
create policy checkin_images_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
  )
);

create table private.storage_upload_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0
    check (attempt_count >= 0)
);

create table private.storage_upload_reservations (
  path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reserved_bytes bigint not null
    check (reserved_bytes > 0 and reserved_bytes <= 10485760),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index storage_upload_reservations_user_expiry_idx
  on private.storage_upload_reservations (user_id, expires_at);

revoke all on private.storage_upload_limits
  from public, anon, authenticated;
revoke all on private.storage_upload_reservations
  from public, anon, authenticated;

create or replace function public.reserve_checkin_image_upload(
  target_user_id uuid,
  target_path text,
  target_size bigint
)
returns table (
  allowed boolean,
  reason text,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_limit private.storage_upload_limits%rowtype;
  request_time timestamptz := now();
  window_end timestamptz;
  stored_count bigint;
  stored_bytes bigint;
  reserved_count bigint;
  reserved_bytes bigint;
  max_attempts constant integer := 5;
  window_seconds constant integer := 600;
  max_objects constant integer := 400;
  max_bytes constant bigint := 536870912;
  max_object_bytes constant bigint := 10485760;
begin
  if target_user_id is null
    or target_path is null
    or target_size is null
    or target_size <= 0
    or target_size > 10485760
    or length(target_path) > 1024
    or split_part(target_path, '/', 1) <> target_user_id::text
    or target_path !~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '/[0-9]{4}-[0-9]{2}-[0-9]{2}'
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '[.](jpg|png|webp)$'
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid storage upload reservation';
  end if;

  insert into private.storage_upload_limits (
    user_id,
    window_started_at,
    attempt_count
  )
  values (target_user_id, request_time, 0)
  on conflict (user_id) do nothing;

  select *
  into current_limit
  from private.storage_upload_limits
  where user_id = target_user_id
  for update;

  window_end := current_limit.window_started_at
    + make_interval(secs => window_seconds);
  if request_time >= window_end then
    update private.storage_upload_limits
    set window_started_at = request_time,
        attempt_count = 0
    where user_id = target_user_id
    returning * into current_limit;
    window_end := request_time + make_interval(secs => window_seconds);
  end if;

  if current_limit.attempt_count >= max_attempts then
    return query
      select
        false,
        'RATE_LIMITED'::text,
        greatest(
          1,
          ceil(extract(epoch from (window_end - request_time)))::integer
        );
    return;
  end if;

  update private.storage_upload_limits
  set attempt_count = attempt_count + 1
  where user_id = target_user_id;

  delete from private.storage_upload_reservations reservations
  where reservations.user_id = target_user_id
    and (
      reservations.expires_at <= request_time
      or exists (
        select 1
        from storage.objects objects
        where objects.bucket_id = 'checkin-images'
          and objects.name = reservations.path
      )
    );

  select
    count(*),
    coalesce(
      sum(
        case
          when objects.metadata ->> 'size' ~ '^[0-9]+$'
            then (objects.metadata ->> 'size')::bigint
          else 0
        end
      ),
      0
    )
  into stored_count, stored_bytes
  from storage.objects objects
  where objects.bucket_id = 'checkin-images'
    and (storage.foldername(objects.name))[1] = target_user_id::text;

  select count(*), coalesce(sum(reservations.reserved_bytes), 0)
  into reserved_count, reserved_bytes
  from private.storage_upload_reservations reservations
  where reservations.user_id = target_user_id;

  if stored_count + reserved_count >= max_objects
    or stored_bytes + reserved_bytes + max_object_bytes > max_bytes then
    return query
      select false, 'STORAGE_QUOTA_EXCEEDED'::text, 0;
    return;
  end if;

  insert into private.storage_upload_reservations (
    path,
    user_id,
    reserved_bytes,
    expires_at
  )
  values (
    target_path,
    target_user_id,
    max_object_bytes,
    request_time + interval '2 hours'
  );

  return query select true, null::text, 0;
end;
$$;

create or replace function public.release_checkin_image_upload_reservation(
  target_user_id uuid,
  target_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.storage_upload_reservations
  where user_id = target_user_id
    and path = target_path;
  return found;
end;
$$;

revoke all on function public.reserve_checkin_image_upload(uuid, text, bigint)
  from public, anon, authenticated;
revoke all on function public.release_checkin_image_upload_reservation(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_checkin_image_upload(uuid, text, bigint)
  to service_role;
grant execute on function public.release_checkin_image_upload_reservation(uuid, text)
  to service_role;
