alter table public.profiles
  add column onboarding_completed boolean not null default false;

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

create function public.complete_profile_onboarding(
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
