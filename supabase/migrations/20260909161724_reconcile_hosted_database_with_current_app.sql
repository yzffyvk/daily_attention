-- Forward reconciliation for the existing hosted database and the current local baseline.
-- The hosted July migration IDs differ from the repository IDs. Do not replay or
-- mark the destructive historical resets as applied. This migration preserves data,
-- migration history, and the nickname sequence value. It does not enable AI traffic,
-- deploy workers, or change Auth dashboard settings.
-- Legacy-schema reconciliation is allowed only with no account/check-in/image data.
-- Locks make that precondition stable for the migration transaction.
set local lock_timeout = '10s';
set local statement_timeout = '120s';

lock table auth.users in share row exclusive mode;
lock table public.profiles, public.check_ins,
  private.account_recovery_credentials in access exclusive mode;
lock table storage.objects in share row exclusive mode;

do $preflight$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_phone_check'
  ) or exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.complete_registration(uuid,text,smallint,bytea)')
      and proargnames[2] = 'target_phone'
  ) then
    if exists (select 1 from auth.users)
      or exists (select 1 from public.profiles)
      or exists (select 1 from public.check_ins)
      or exists (select 1 from private.account_recovery_credentials)
      or exists (select 1 from storage.objects where bucket_id = 'checkin-images')
    then
      raise exception 'HOSTED_RECONCILIATION_REQUIRES_EMPTY_LEGACY_ACCOUNTS';
    end if;
  end if;
  if (to_regclass('private.ai_generation_jobs') is null)
    <> (to_regclass('private.ai_daily_quotas') is null)
  then
    raise exception 'PARTIAL_AI_SCHEMA_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$preflight$;

-- The hosted column was renamed to email outside migration history, but retained
-- its phone constraint. Accept either old column name without truncating data.
do $profile_shape$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone'
  ) then
    alter table public.profiles rename column phone to email;
  end if;
  if exists (
    select 1 from public.profiles
    where email is null or length(email) > 254
      or email <> lower(email)
      or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'PROFILE_EMAIL_DATA_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$profile_shape$;

alter table public.profiles
  drop constraint if exists profiles_phone_check,
  drop constraint if exists profiles_phone_key;
alter table public.profiles alter column email type varchar(254);
alter table public.profiles add column if not exists
  onboarding_completed boolean not null default false;

do $profile_constraints$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_email_key'
  ) then
    alter table public.profiles add constraint profiles_email_key unique (email);
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_email_check'
  ) then
    alter table public.profiles add constraint profiles_email_check check (
      email = pg_catalog.lower(email)
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    );
  end if;
end;
$profile_constraints$;

-- PostgreSQL cannot rename an existing input argument with CREATE OR REPLACE.
-- Remove only the obsolete phone-signature function, without CASCADE.
do $registration_signature$
begin
  if exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.complete_registration(uuid,text,smallint,bytea)')
      and proargnames[2] = 'target_phone'
  ) then
    drop function public.complete_registration(uuid, text, smallint, bytea);
  end if;
end;
$registration_signature$;
drop function if exists public.resolve_phone(text);

-- Restore the exact current application account/onboarding definitions.
create or replace function public.complete_registration(
  target_user_id uuid,
  target_email text,
  target_avatar_key smallint,
  target_recovery_digest bytea
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_name_number bigint;
  created_profile public.profiles;
begin
  if target_email is null
    or pg_catalog.length(target_email) > 254
    or target_email <> pg_catalog.lower(target_email)
    or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'INVALID_EMAIL' using errcode = '23514';
  end if;

  display_name_number := pg_catalog.nextval(
    'private.attention_display_name_seq'::regclass
  );

  insert into public.profiles (
    id,
    email,
    display_name,
    avatar_key,
    onboarding_completed
  )
  values (
    target_user_id,
    target_email,
    'Attention_' || pg_catalog.to_char(display_name_number, 'FM000'),
    target_avatar_key,
    false
  )
  returning * into created_profile;

  insert into private.account_recovery_credentials (
    user_id,
    recovery_code_digest
  )
  values (
    target_user_id,
    target_recovery_digest
  );

  return created_profile;
end;
$$;

create or replace function public.complete_profile_onboarding(
  target_user_id uuid,
  target_display_name text,
  target_avatar_key smallint
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_profile public.profiles;
begin
  update public.profiles
  set display_name = target_display_name,
      avatar_key = target_avatar_key,
      onboarding_completed = true
  where id = target_user_id
    and onboarding_completed = false
  returning * into completed_profile;

  if completed_profile.id is null then
    select profiles
    into completed_profile
    from public.profiles profiles
    where profiles.id = target_user_id;
  end if;

  if completed_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return completed_profile;
end;
$$;

revoke all on function public.complete_profile_onboarding(uuid, text, smallint)
from public, anon, authenticated;
grant execute on function public.complete_profile_onboarding(uuid, text, smallint)
to service_role;

create or replace function public.resolve_email(target_email text)
returns table (user_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select profiles.id
  from public.profiles
  where profiles.email = target_email
  limit 1;
$$;

create or replace function public.read_profile(target_user_id uuid)
returns public.profiles
language sql
security definer
stable
set search_path = ''
as $$
  select profiles
  from public.profiles profiles
  where profiles.id = target_user_id;
$$;

create or replace function public.update_profile(
  target_user_id uuid,
  target_display_name text,
  target_avatar_key smallint
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  update public.profiles
  set display_name = target_display_name,
      avatar_key = target_avatar_key
  where id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.complete_registration(uuid, text, smallint, bytea) from public, anon, authenticated;
revoke all on function public.resolve_email(text) from public, anon, authenticated;
revoke all on function public.read_profile(uuid) from public, anon, authenticated;
revoke all on function public.read_recovery_digest(uuid) from public, anon, authenticated;
revoke all on function public.replace_recovery_digest(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function public.update_profile(uuid, text, smallint) from public, anon, authenticated;

grant execute on function public.complete_registration(uuid, text, smallint, bytea) to service_role;
grant execute on function public.resolve_email(text) to service_role;
grant execute on function public.read_profile(uuid) to service_role;
grant execute on function public.read_recovery_digest(uuid) to service_role;
grant execute on function public.replace_recovery_digest(uuid, bytea, bytea) to service_role;
grant execute on function public.update_profile(uuid, text, smallint) to service_role;

create or replace function public.resolve_recovery_challenge(target_email text)
returns table (user_id uuid, recovery_code_digest bytea)
language sql
security definer
stable
set search_path = ''
as $$
  select
    profiles.id,
    coalesce(credentials.recovery_code_digest, decode(repeat('00', 32), 'hex'))
  from (values (1)) as seed(value)
  left join public.profiles profiles on profiles.email = target_email
  left join private.account_recovery_credentials credentials on credentials.user_id = profiles.id;
$$;

revoke all on function public.resolve_recovery_challenge(text) from public, anon, authenticated;
grant execute on function public.resolve_recovery_challenge(text) to service_role;

create or replace function private.block_unsupported_auth_emails(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_type text;
begin
  if jsonb_typeof(event) <> 'object'
    or jsonb_typeof(event -> 'email_data') <> 'object'
    or jsonb_typeof(event -> 'email_data' -> 'email_action_type') <> 'string'
  then
    return '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb;
  end if;

  action_type := event #>> '{email_data,email_action_type}';
  if action_type in (
    'password_changed_notification',
    'email_changed_notification',
    'phone_changed_notification',
    'identity_linked_notification',
    'identity_unlinked_notification',
    'mfa_factor_enrolled_notification',
    'mfa_factor_unenrolled_notification'
  ) then
    return '{}'::jsonb;
  end if;

  return '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb;
end;
$$;

revoke execute on function private.block_unsupported_auth_emails(jsonb)
from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.block_unsupported_auth_emails(jsonb)
to supabase_auth_admin;


-- Align table privileges with the application contract, including removal of
-- legacy TRUNCATE/TRIGGER grants. RLS does not protect TRUNCATE.
alter table public.profiles enable row level security;
alter table public.check_ins enable row level security;
revoke all on public.profiles, public.check_ins from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.check_ins to authenticated;
grant select, insert, update, delete on public.profiles, public.check_ins to service_role;
revoke all on schema private from public, anon, authenticated;
revoke all on private.auth_rate_limits, private.account_recovery_credentials,
  private.storage_upload_limits, private.storage_upload_reservations
  from public, anon, authenticated;

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


-- Replace the drifted upload-capacity function with the checked-in definition.
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

create or replace function public.get_check_in_stats(target_today date)
returns table (
  total_count bigint,
  current_streak integer,
  has_today_record boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  owned_dates as materialized (
    select records.checkin_date
    from public.check_ins records
    where records.user_id = (select auth.uid())
      and records.checkin_date <= target_today
  ),
  anchor as (
    select case
      when exists (
        select 1
        from owned_dates
        where checkin_date = target_today
      ) then target_today
      else target_today - 1
    end as day
  ),
  streak(day, length) as (
    select anchor.day, 0
    from anchor

    union all

    select streak.day - 1, streak.length + 1
    from streak
    where exists (
      select 1
      from owned_dates
      where checkin_date = streak.day
    )
  )
  select
    (
      select pg_catalog.count(*)
      from public.check_ins records
      where records.user_id = (select auth.uid())
    )::bigint as total_count,
    coalesce((select pg_catalog.max(length) from streak), 0)::integer
      as current_streak,
    exists (
      select 1
      from owned_dates
      where checkin_date = target_today
    ) as has_today_record;
$$;

revoke all on function public.get_check_in_stats(date)
  from public, anon, authenticated;
grant execute on function public.get_check_in_stats(date) to authenticated;

create or replace function public.delete_expired_storage_upload_reservations(
  target_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'target_limit must be between 1 and 500';
  end if;

  with candidates as (
    select reservations.path
    from private.storage_upload_reservations reservations
    where reservations.expires_at <= pg_catalog.now()
      and not exists (
        select 1
        from storage.objects objects
        where objects.bucket_id = 'checkin-images'
          and objects.name = reservations.path
      )
    order by reservations.expires_at, reservations.path
    limit target_limit
  ),
  deleted as (
    delete from private.storage_upload_reservations reservations
    using candidates
    where reservations.path = candidates.path
    returning 1
  )
  select pg_catalog.count(*)::integer
  into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_storage_upload_reservations(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_expired_storage_upload_reservations(integer)
  to service_role;

create or replace function public.list_orphan_checkin_image_paths(target_limit integer)
returns table (path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'target_limit must be between 1 and 500';
  end if;

  return query
  select objects.name as path
  from storage.objects objects
  where objects.bucket_id = 'checkin-images'
    and objects.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1
      from public.check_ins records
      where records.image_path = objects.name
    )
  order by objects.created_at, objects.name
  limit target_limit;
end;
$$;

revoke all on function public.list_orphan_checkin_image_paths(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_orphan_checkin_image_paths(integer)
  to service_role;


-- Install the AI schema only where missing. On a database that already applied
-- the repository's AI migrations, preserve those tables, types, triggers and data.
do $install_ai$
begin
  if to_regclass('private.ai_generation_jobs') is null then
    execute $ai_schema_sql$
create extension if not exists pgmq;

select pgmq.create('ai_generation_jobs');

create table private.ai_daily_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  reserved_count smallint not null default 0,
  consumed_count smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date),
  check (reserved_count >= 0),
  check (consumed_count >= 0),
  check (reserved_count + consumed_count <= 5)
);

create table private.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  target_date date not null,
  idempotency_key uuid not null,
  source_url text not null,
  source_host varchar(253) not null,
  source_title varchar(300),
  content_digest bytea,
  status varchar(24) not null default 'queued',
  attempt_count smallint not null default 0,
  provider_call_count smallint not null default 0,
  attention varchar(120),
  summary text,
  inspiration text,
  warnings jsonb not null default '[]'::jsonb,
  error_code varchar(80),
  error_message text,
  provider varchar(80) not null default 'deepseek',
  model varchar(160) not null default 'deepseek-v4-pro',
  thinking_enabled boolean not null default true,
  reasoning_effort varchar(16) not null default 'high',
  prompt_version varchar(40) not null default 'ai-summary-v1',
  prompt_tokens integer,
  prompt_cache_hit_tokens integer,
  prompt_cache_miss_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  system_fingerprint varchar(255),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result_expires_at timestamptz,
  metadata_expires_at timestamptz not null default (now() + interval '90 days'),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (user_id, quota_date)
    references private.ai_daily_quotas(user_id, quota_date),
  check (source_url <> '' and length(source_url) <= 2048),
  check (source_host <> ''),
  check (status in (
    'queued', 'fetching', 'generating', 'retryable',
    'succeeded', 'failed', 'cancelled'
  )),
  check (attempt_count between 0 and 3),
  check (provider_call_count >= 0),
  check (reasoning_effort in ('high', 'max')),
  check (summary is null or length(summary) <= 5000),
  check (inspiration is null or length(inspiration) <= 2000),
  check (jsonb_typeof(warnings) = 'array'),
  check (prompt_tokens is null or prompt_tokens >= 0),
  check (prompt_cache_hit_tokens is null or prompt_cache_hit_tokens >= 0),
  check (prompt_cache_miss_tokens is null or prompt_cache_miss_tokens >= 0),
  check (completion_tokens is null or completion_tokens >= 0),
  check (reasoning_tokens is null or reasoning_tokens >= 0),
  check (content_digest is null or octet_length(content_digest) = 32),
  check (
    (status in ('succeeded', 'failed', 'cancelled') and finished_at is not null)
    or (status not in ('succeeded', 'failed', 'cancelled') and finished_at is null)
  ),
  check (
    status <> 'succeeded'
    or result_expires_at is null
    or (
      attention is not null
      and summary is not null
      and inspiration is not null
      and source_title is not null
      and warnings is not null
    )
  ),
  check (
    status <> 'failed'
    or error_code is not null
  )
);

create index ai_generation_jobs_user_created_idx
  on private.ai_generation_jobs (user_id, created_at desc);
create index ai_generation_jobs_status_created_idx
  on private.ai_generation_jobs (status, created_at)
  where status in ('queued', 'retryable');
create index ai_generation_jobs_result_expiry_idx
  on private.ai_generation_jobs (result_expires_at)
  where result_expires_at is not null;
create index ai_generation_jobs_metadata_expiry_idx
  on private.ai_generation_jobs (metadata_expires_at)
  where status in ('succeeded', 'failed', 'cancelled');

create trigger ai_daily_quotas_touch_updated_at
before update on private.ai_daily_quotas
for each row execute function private.touch_updated_at();

create trigger ai_generation_jobs_touch_updated_at
before update on private.ai_generation_jobs
for each row execute function private.touch_updated_at();

revoke all on private.ai_daily_quotas
  from public, anon, authenticated, service_role;
revoke all on private.ai_generation_jobs
  from public, anon, authenticated, service_role;

create type public.ai_generation_job_record as (
  id uuid,
  user_id uuid,
  target_date date,
  idempotency_key uuid,
  source_url text,
  source_host varchar(253),
  source_title varchar(300),
  status varchar(24),
  attempt_count integer,
  provider_call_count integer,
  attention varchar(120),
  summary text,
  inspiration text,
  warnings jsonb,
  error_code varchar(80),
  error_message text,
  provider varchar(80),
  model varchar(160),
  thinking_enabled boolean,
  reasoning_effort varchar(16),
  prompt_version varchar(40),
  prompt_tokens integer,
  prompt_cache_hit_tokens integer,
  prompt_cache_miss_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  system_fingerprint varchar(255),
  created_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result_expires_at timestamptz,
  metadata_expires_at timestamptz,
  updated_at timestamptz
);

create type public.ai_generation_job_with_quota as (
  job public.ai_generation_job_record,
  quota_used integer,
  quota_reserved integer,
  quota_consumed integer,
  quota_remaining integer
);

create function private.to_ai_generation_job_record(
  target private.ai_generation_jobs
)
returns public.ai_generation_job_record
language sql
stable
set search_path = ''
as $$
  select row(
    target.id,
    target.user_id,
    target.target_date,
    target.idempotency_key,
    target.source_url,
    target.source_host,
    target.source_title,
    target.status,
    target.attempt_count,
    target.provider_call_count,
    target.attention,
    target.summary,
    target.inspiration,
    target.warnings,
    target.error_code,
    target.error_message,
    target.provider,
    target.model,
    target.thinking_enabled,
    target.reasoning_effort,
    target.prompt_version,
    target.prompt_tokens,
    target.prompt_cache_hit_tokens,
    target.prompt_cache_miss_tokens,
    target.completion_tokens,
    target.reasoning_tokens,
    target.system_fingerprint,
    target.created_at,
    target.started_at,
    target.finished_at,
    target.result_expires_at,
    target.metadata_expires_at,
    target.updated_at
  )::public.ai_generation_job_record;
$$;

revoke all on function private.to_ai_generation_job_record(private.ai_generation_jobs)
  from public, anon, authenticated, service_role;

create function public.create_ai_generation_job(
  target_user_id uuid,
  target_date date,
  target_idempotency_key uuid,
  target_source_url text,
  target_source_host text
)
returns setof public.ai_generation_job_with_quota
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_quota private.ai_daily_quotas%rowtype;
  existing_job private.ai_generation_jobs%rowtype;
  created_job private.ai_generation_jobs%rowtype;
  current_quota_date date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
begin
  if target_user_id is null
    or target_date is null
    or target_idempotency_key is null
    or target_source_url is null
    or target_source_host is null
    or target_source_url = ''
    or target_source_host = ''
    or pg_catalog.length(target_source_url) > 2048
    or pg_catalog.length(target_source_host) > 253 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI generation job';
  end if;

  select jobs.*
  into existing_job
  from private.ai_generation_jobs jobs
  where jobs.user_id = target_user_id
    and jobs.idempotency_key = target_idempotency_key;

  if found then
    select quotas.*
    into current_quota
    from private.ai_daily_quotas quotas
    where quotas.user_id = existing_job.user_id
      and quotas.quota_date = existing_job.quota_date;

    return query
    select
      private.to_ai_generation_job_record(existing_job),
      (current_quota.reserved_count + current_quota.consumed_count)::integer,
      current_quota.reserved_count::integer,
      current_quota.consumed_count::integer,
      (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
    return;
  end if;

  insert into private.ai_daily_quotas (user_id, quota_date)
  values (target_user_id, current_quota_date)
  on conflict (user_id, quota_date) do nothing;

  select quotas.*
  into current_quota
  from private.ai_daily_quotas quotas
  where quotas.user_id = target_user_id
    and quotas.quota_date = current_quota_date
  for update;

  select jobs.*
  into existing_job
  from private.ai_generation_jobs jobs
  where jobs.user_id = target_user_id
    and jobs.idempotency_key = target_idempotency_key;

  if found then
    select quotas.*
    into current_quota
    from private.ai_daily_quotas quotas
    where quotas.user_id = existing_job.user_id
      and quotas.quota_date = existing_job.quota_date;

    return query
    select
      private.to_ai_generation_job_record(existing_job),
      (current_quota.reserved_count + current_quota.consumed_count)::integer,
      current_quota.reserved_count::integer,
      current_quota.consumed_count::integer,
      (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
    return;
  end if;

  if current_quota.reserved_count + current_quota.consumed_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'DAILY_AI_LIMIT_REACHED';
  end if;

  update private.ai_daily_quotas quotas
  set reserved_count = quotas.reserved_count + 1
  where quotas.user_id = target_user_id
    and quotas.quota_date = current_quota_date
  returning quotas.* into current_quota;

  insert into private.ai_generation_jobs (
    user_id,
    quota_date,
    target_date,
    idempotency_key,
    source_url,
    source_host
  ) values (
    target_user_id,
    current_quota_date,
    target_date,
    target_idempotency_key,
    target_source_url,
    pg_catalog.lower(target_source_host)
  )
  returning * into created_job;

  perform pgmq.send(
    'ai_generation_jobs',
    pg_catalog.jsonb_build_object('job_id', created_job.id)
  );

  return query
  select
    private.to_ai_generation_job_record(created_job),
    (current_quota.reserved_count + current_quota.consumed_count)::integer,
    current_quota.reserved_count::integer,
    current_quota.consumed_count::integer,
    (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
end;
$$;

create function public.read_ai_generation_job(
  target_user_id uuid,
  target_job_id uuid
)
returns setof public.ai_generation_job_record
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_ai_generation_job_record(jobs)
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
    and jobs.user_id = target_user_id;
$$;

create function public.cancel_ai_generation_job(
  target_user_id uuid,
  target_job_id uuid
)
returns setof public.ai_generation_job_with_quota
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
  current_quota private.ai_daily_quotas%rowtype;
begin
  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
    and jobs.user_id = target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN_JOB';
  end if;

  if current_job.status <> 'queued' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  update private.ai_daily_quotas quotas
  set reserved_count = quotas.reserved_count - 1
  where quotas.user_id = current_job.user_id
    and quotas.quota_date = current_job.quota_date
  returning quotas.* into current_quota;

  update private.ai_generation_jobs jobs
  set status = 'cancelled',
      finished_at = pg_catalog.now(),
      result_expires_at = pg_catalog.now() + interval '24 hours'
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return query
  select
    private.to_ai_generation_job_record(current_job),
    (current_quota.reserved_count + current_quota.consumed_count)::integer,
    current_quota.reserved_count::integer,
    current_quota.consumed_count::integer,
    (5 - current_quota.reserved_count - current_quota.consumed_count)::integer;
end;
$$;

create function public.claim_ai_generation_job(target_job_id uuid)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_job private.ai_generation_jobs%rowtype;
begin
  update private.ai_generation_jobs jobs
  set status = 'fetching',
      attempt_count = jobs.attempt_count + 1
  where jobs.id = target_job_id
    and jobs.status in ('queued', 'retryable')
    and jobs.attempt_count < 3
  returning jobs.* into claimed_job;

  if not found then
    return;
  end if;

  return next private.to_ai_generation_job_record(claimed_job);
end;
$$;

create function public.mark_ai_generation_fetch_failure(
  target_job_id uuid,
  target_error_code text,
  target_error_message text,
  target_retryable boolean
)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  if target_error_code is null
    or target_error_message is null
    or target_retryable is null
    or target_error_code = ''
    or pg_catalog.length(target_error_code) > 80 then
    raise exception using errcode = '22023', message = 'invalid fetch failure';
  end if;

  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'fetching' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  if target_retryable and current_job.attempt_count < 3 then
    update private.ai_generation_jobs jobs
    set status = 'retryable',
        error_code = target_error_code,
        error_message = target_error_message
    where jobs.id = current_job.id
    returning jobs.* into current_job;
  else
    if current_job.started_at is null then
      update private.ai_daily_quotas quotas
      set reserved_count = quotas.reserved_count - 1
      where quotas.user_id = current_job.user_id
        and quotas.quota_date = current_job.quota_date;
    end if;

    update private.ai_generation_jobs jobs
    set status = 'failed',
        error_code = target_error_code,
        error_message = target_error_message,
        finished_at = pg_catalog.now(),
        result_expires_at = pg_catalog.now() + interval '24 hours'
    where jobs.id = current_job.id
    returning jobs.* into current_job;
  end if;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.begin_ai_generation(target_job_id uuid)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'fetching' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  if current_job.started_at is null then
    update private.ai_daily_quotas quotas
    set reserved_count = quotas.reserved_count - 1,
        consumed_count = quotas.consumed_count + 1
    where quotas.user_id = current_job.user_id
      and quotas.quota_date = current_job.quota_date;
  end if;

  update private.ai_generation_jobs jobs
  set status = 'generating',
      started_at = coalesce(jobs.started_at, pg_catalog.now()),
      error_code = null,
      error_message = null
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.complete_ai_generation_job(
  target_job_id uuid,
  target_succeeded boolean,
  target_attention text,
  target_summary text,
  target_inspiration text,
  target_source_title text,
  target_warnings jsonb,
  target_error_code text,
  target_error_message text,
  target_provider_call_count integer,
  target_prompt_tokens integer,
  target_prompt_cache_hit_tokens integer,
  target_prompt_cache_miss_tokens integer,
  target_completion_tokens integer,
  target_reasoning_tokens integer,
  target_model text,
  target_system_fingerprint text,
  target_content_digest bytea
)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  if target_succeeded is null
    or target_provider_call_count is null
    or target_provider_call_count < 0
    or target_model is null
    or target_model = ''
    or pg_catalog.length(target_model) > 160
    or (target_system_fingerprint is not null and pg_catalog.length(target_system_fingerprint) > 255)
    or (target_error_code is not null and pg_catalog.length(target_error_code) > 80)
    or (target_attention is not null and pg_catalog.length(target_attention) > 120)
    or (target_summary is not null and pg_catalog.length(target_summary) > 5000)
    or (target_inspiration is not null and pg_catalog.length(target_inspiration) > 2000)
    or (target_source_title is not null and pg_catalog.length(target_source_title) > 300)
    or (target_content_digest is not null and pg_catalog.octet_length(target_content_digest) <> 32)
    or target_warnings is null
    or pg_catalog.jsonb_typeof(target_warnings) <> 'array'
    or (target_prompt_tokens is not null and target_prompt_tokens < 0)
    or (target_prompt_cache_hit_tokens is not null and target_prompt_cache_hit_tokens < 0)
    or (target_prompt_cache_miss_tokens is not null and target_prompt_cache_miss_tokens < 0)
    or (target_completion_tokens is not null and target_completion_tokens < 0)
    or (target_reasoning_tokens is not null and target_reasoning_tokens < 0)
    or (
      target_succeeded
      and (
        target_attention is null
        or target_summary is null
        or target_inspiration is null
        or target_source_title is null
        or target_content_digest is null
      )
    )
    or (
      not target_succeeded
      and (
        target_error_code is null
        or target_error_message is null
        or target_error_code = ''
      )
    ) then
    raise exception using errcode = '22023', message = 'invalid AI completion';
  end if;

  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'generating' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  update private.ai_generation_jobs jobs
  set status = case when target_succeeded then 'succeeded' else 'failed' end,
      attention = case when target_succeeded then target_attention else null end,
      summary = case when target_succeeded then target_summary else null end,
      inspiration = case when target_succeeded then target_inspiration else null end,
      source_title = case when target_succeeded then target_source_title else null end,
      warnings = target_warnings,
      error_code = case when target_succeeded then null else target_error_code end,
      error_message = case when target_succeeded then null else target_error_message end,
      provider_call_count = jobs.provider_call_count + target_provider_call_count,
      prompt_tokens = target_prompt_tokens,
      prompt_cache_hit_tokens = target_prompt_cache_hit_tokens,
      prompt_cache_miss_tokens = target_prompt_cache_miss_tokens,
      completion_tokens = target_completion_tokens,
      reasoning_tokens = target_reasoning_tokens,
      model = target_model,
      system_fingerprint = target_system_fingerprint,
      content_digest = target_content_digest,
      finished_at = pg_catalog.now(),
      result_expires_at = pg_catalog.now() + interval '24 hours'
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.expire_ai_generation_data(target_limit integer)
returns table (cleared_results integer, deleted_jobs integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'target_limit must be between 1 and 500';
  end if;

  with candidates as (
    select jobs.id
    from private.ai_generation_jobs jobs
    where jobs.status in ('succeeded', 'failed', 'cancelled')
      and jobs.result_expires_at <= pg_catalog.now()
    order by jobs.result_expires_at, jobs.id
    limit target_limit
    for update skip locked
  ),
  cleared as (
    update private.ai_generation_jobs jobs
    set attention = null,
        summary = null,
        inspiration = null,
        source_title = null,
        warnings = '[]'::jsonb,
        error_message = null,
        content_digest = null,
        result_expires_at = null
    from candidates
    where jobs.id = candidates.id
    returning 1
  )
  select pg_catalog.count(*)::integer
  into cleared_results
  from cleared;

  with candidates as (
    select jobs.id
    from private.ai_generation_jobs jobs
    where jobs.status in ('succeeded', 'failed', 'cancelled')
      and jobs.metadata_expires_at <= pg_catalog.now()
    order by jobs.metadata_expires_at, jobs.id
    limit target_limit
    for update skip locked
  ),
  deleted as (
    delete from private.ai_generation_jobs jobs
    using candidates
    where jobs.id = candidates.id
    returning 1
  )
  select pg_catalog.count(*)::integer
  into deleted_jobs
  from deleted;

  return next;
end;
$$;

revoke all on function public.create_ai_generation_job(uuid, date, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_ai_generation_job(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_ai_generation_job(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_ai_generation_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_ai_generation_fetch_failure(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_ai_generation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_ai_generation_job(
  uuid, boolean, text, text, text, text, jsonb, text, text, integer,
  integer, integer, integer, integer, integer, text, text, bytea
)
  from public, anon, authenticated, service_role;
revoke all on function public.expire_ai_generation_data(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.create_ai_generation_job(uuid, date, uuid, text, text)
  to service_role;
grant execute on function public.read_ai_generation_job(uuid, uuid)
  to service_role;
grant execute on function public.cancel_ai_generation_job(uuid, uuid)
  to service_role;
grant execute on function public.claim_ai_generation_job(uuid)
  to service_role;
grant execute on function public.mark_ai_generation_fetch_failure(uuid, text, text, boolean)
  to service_role;
grant execute on function public.begin_ai_generation(uuid)
  to service_role;
grant execute on function public.complete_ai_generation_job(
  uuid, boolean, text, text, text, text, jsonb, text, text, integer,
  integer, integer, integer, integer, integer, text, text, bytea
)
  to service_role;
grant execute on function public.expire_ai_generation_data(integer)
  to service_role;

$ai_schema_sql$;
    execute $ai_worker_sql$
create or replace function public.claim_ai_generation_job(target_job_id uuid)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
begin
  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status not in (
    'queued', 'fetching', 'generating', 'retryable'
  ) then
    return;
  end if;

  if current_job.attempt_count >= 3 then
    if current_job.started_at is null then
      update private.ai_daily_quotas quotas
      set reserved_count = quotas.reserved_count - 1
      where quotas.user_id = current_job.user_id
        and quotas.quota_date = current_job.quota_date;
    end if;

    update private.ai_generation_jobs jobs
    set status = 'failed',
        error_code = 'TASK_RETRY_EXHAUSTED',
        error_message = '任务多次尝试后仍未成功',
        finished_at = pg_catalog.now(),
        result_expires_at = pg_catalog.now() + interval '24 hours'
    where jobs.id = current_job.id;
    return;
  end if;

  update private.ai_generation_jobs jobs
  set status = 'fetching',
      attempt_count = jobs.attempt_count + 1,
      error_code = null,
      error_message = null
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

create function public.read_ai_generation_queue(
  target_visibility_timeout integer,
  target_batch_limit integer
)
returns table (
  msg_id bigint,
  read_count integer,
  enqueued_at timestamptz,
  visible_at timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_visibility_timeout is null
    or target_visibility_timeout < 30
    or target_visibility_timeout > 900
    or target_batch_limit is null
    or target_batch_limit < 1
    or target_batch_limit > 5 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI queue read parameters';
  end if;

  return query
  select
    delivery.msg_id,
    delivery.read_ct,
    delivery.enqueued_at,
    delivery.vt,
    delivery.message
  from pgmq.read(
    'ai_generation_jobs',
    target_visibility_timeout,
    target_batch_limit
  ) as delivery;
end;
$$;

create function public.delete_ai_generation_queue_message(target_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_msg_id is null or target_msg_id < 1 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI queue message id';
  end if;

  return pgmq.delete('ai_generation_jobs', target_msg_id);
end;
$$;

create function public.delay_ai_generation_queue_message(
  target_msg_id bigint,
  target_delay_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delayed boolean;
begin
  if target_msg_id is null
    or target_msg_id < 1
    or target_delay_seconds is null
    or target_delay_seconds < 1
    or target_delay_seconds > 300 then
    raise exception using
      errcode = '22023',
      message = 'invalid AI queue delay parameters';
  end if;

  select exists(
    select 1
    from pgmq.set_vt(
      'ai_generation_jobs',
      target_msg_id,
      target_delay_seconds
    )
  ) into delayed;

  return delayed;
end;
$$;

create function private.accumulate_ai_generation_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'generating'
    and new.status in ('retryable', 'succeeded', 'failed')
    and new.provider_call_count > old.provider_call_count then
    new.prompt_tokens := case
      when old.prompt_tokens is null and new.prompt_tokens is null then null
      else coalesce(old.prompt_tokens, 0) + coalesce(new.prompt_tokens, 0)
    end;
    new.prompt_cache_hit_tokens := case
      when old.prompt_cache_hit_tokens is null and new.prompt_cache_hit_tokens is null then null
      else coalesce(old.prompt_cache_hit_tokens, 0) + coalesce(new.prompt_cache_hit_tokens, 0)
    end;
    new.prompt_cache_miss_tokens := case
      when old.prompt_cache_miss_tokens is null and new.prompt_cache_miss_tokens is null then null
      else coalesce(old.prompt_cache_miss_tokens, 0) + coalesce(new.prompt_cache_miss_tokens, 0)
    end;
    new.completion_tokens := case
      when old.completion_tokens is null and new.completion_tokens is null then null
      else coalesce(old.completion_tokens, 0) + coalesce(new.completion_tokens, 0)
    end;
    new.reasoning_tokens := case
      when old.reasoning_tokens is null and new.reasoning_tokens is null then null
      else coalesce(old.reasoning_tokens, 0) + coalesce(new.reasoning_tokens, 0)
    end;
  end if;

  return new;
end;
$$;

create trigger ai_generation_jobs_accumulate_usage
before update on private.ai_generation_jobs
for each row execute function private.accumulate_ai_generation_usage();

create function public.mark_ai_generation_provider_failure(
  target_job_id uuid,
  target_error_code text,
  target_error_message text,
  target_retryable boolean,
  target_provider_call_count integer,
  target_prompt_tokens integer,
  target_prompt_cache_hit_tokens integer,
  target_prompt_cache_miss_tokens integer,
  target_completion_tokens integer,
  target_reasoning_tokens integer
)
returns setof public.ai_generation_job_record
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job private.ai_generation_jobs%rowtype;
  retry_allowed boolean;
begin
  if target_job_id is null
    or target_error_code is null
    or target_error_code = ''
    or pg_catalog.length(target_error_code) > 80
    or target_error_message is null
    or target_retryable is null
    or target_provider_call_count is null
    or target_provider_call_count < 0
    or target_prompt_tokens is null
    or target_prompt_tokens < 0
    or target_prompt_cache_hit_tokens is null
    or target_prompt_cache_hit_tokens < 0
    or target_prompt_cache_miss_tokens is null
    or target_prompt_cache_miss_tokens < 0
    or target_completion_tokens is null
    or target_completion_tokens < 0
    or target_reasoning_tokens is null
    or target_reasoning_tokens < 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid provider failure';
  end if;

  select jobs.*
  into current_job
  from private.ai_generation_jobs jobs
  where jobs.id = target_job_id
  for update;

  if not found or current_job.status <> 'generating' then
    raise exception using
      errcode = 'P0001',
      message = 'AI_JOB_INVALID_TRANSITION';
  end if;

  retry_allowed := target_retryable and current_job.attempt_count < 3;

  update private.ai_generation_jobs jobs
  set status = case when retry_allowed then 'retryable' else 'failed' end,
      error_code = target_error_code,
      error_message = target_error_message,
      provider_call_count = jobs.provider_call_count + target_provider_call_count,
      prompt_tokens = target_prompt_tokens,
      prompt_cache_hit_tokens = target_prompt_cache_hit_tokens,
      prompt_cache_miss_tokens = target_prompt_cache_miss_tokens,
      completion_tokens = target_completion_tokens,
      reasoning_tokens = target_reasoning_tokens,
      finished_at = case when retry_allowed then null else pg_catalog.now() end,
      result_expires_at = case
        when retry_allowed then null
        else pg_catalog.now() + interval '24 hours'
      end
  where jobs.id = current_job.id
  returning jobs.* into current_job;

  return next private.to_ai_generation_job_record(current_job);
end;
$$;

revoke all on function public.read_ai_generation_queue(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_ai_generation_queue_message(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.delay_ai_generation_queue_message(bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.accumulate_ai_generation_usage()
  from public, anon, authenticated, service_role;
revoke all on function public.mark_ai_generation_provider_failure(
  uuid, text, text, boolean, integer, integer, integer, integer, integer, integer
)
  from public, anon, authenticated, service_role;

grant execute on function public.read_ai_generation_queue(integer, integer)
  to service_role;
grant execute on function public.delete_ai_generation_queue_message(bigint)
  to service_role;
grant execute on function public.delay_ai_generation_queue_message(bigint, integer)
  to service_role;
grant execute on function public.mark_ai_generation_provider_failure(
  uuid, text, text, boolean, integer, integer, integer, integer, integer, integer
)
  to service_role;

$ai_worker_sql$;
  end if;
end;
$install_ai$;

-- Include the latest action allowlist and lock-safe rate limiter for both paths.
create or replace function public.consume_auth_rate_limit(
  target_bucket bytea,
  target_action text,
  target_max_attempts integer,
  target_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.auth_rate_limits%rowtype;
  request_time timestamptz := pg_catalog.now();
  window_end timestamptz;
begin
  if target_bucket is null
    or pg_catalog.octet_length(target_bucket) <> 32
    or target_action is null
    or target_max_attempts is null
    or target_window_seconds is null
    or target_max_attempts <= 0
    or target_window_seconds <= 0
    or not (
      (target_action = 'register' and target_max_attempts = 5 and target_window_seconds = 3600)
      or (target_action = 'login' and target_max_attempts = 10 and target_window_seconds = 900)
      or (target_action = 'recover' and target_max_attempts = 5 and target_window_seconds = 1800)
      or (target_action = 'rotate' and target_max_attempts = 5 and target_window_seconds = 3600)
      or (target_action = 'ai_generate' and target_max_attempts = 10 and target_window_seconds = 600)
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid auth rate limit parameters';
  end if;

  insert into private.auth_rate_limits (
    bucket_digest,
    action,
    window_started_at,
    attempt_count
  )
  values (target_bucket, target_action, request_time, 1)
  on conflict (bucket_digest, action) do nothing;

  if found then
    return query select true, 0;
    return;
  end if;

  select limits.*
  into current_row
  from private.auth_rate_limits limits
  where limits.bucket_digest = target_bucket
    and limits.action = target_action
  for update;

  window_end := current_row.window_started_at
    + pg_catalog.make_interval(secs => target_window_seconds);

  if request_time >= window_end then
    update private.auth_rate_limits limits
    set window_started_at = request_time,
        attempt_count = 1,
        blocked_until = null
    where limits.bucket_digest = target_bucket
      and limits.action = target_action;
    return query select true, 0;
    return;
  end if;

  if current_row.attempt_count >= target_max_attempts then
    update private.auth_rate_limits limits
    set blocked_until = window_end
    where limits.bucket_digest = target_bucket
      and limits.action = target_action;
    return query
    select
      false,
      greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from (window_end - request_time))
        )::integer
      );
    return;
  end if;

  update private.auth_rate_limits limits
  set attempt_count = limits.attempt_count + 1
  where limits.bucket_digest = target_bucket
    and limits.action = target_action;
  return query select true, 0;
end;
$$;

revoke all on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  to service_role;


notify pgrst, 'reload schema';
