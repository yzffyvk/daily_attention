alter table public.profiles
  drop constraint profiles_phone_check,
  drop constraint profiles_phone_key;

alter table public.profiles
  rename column phone to email;

alter table public.profiles
  alter column email type varchar(254),
  add constraint profiles_email_key unique (email),
  add constraint profiles_email_check check (
    email = pg_catalog.lower(email)
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

drop function public.resolve_phone(text);
drop function public.complete_registration(uuid, text, smallint, bytea);

create function public.complete_registration(
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

  display_name_number := pg_catalog.nextval('private.attention_display_name_seq'::regclass);

  insert into public.profiles (id, email, display_name, avatar_key)
  values (
    target_user_id,
    target_email,
    'Attention_' || pg_catalog.to_char(display_name_number, 'FM000'),
    target_avatar_key
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

create function public.resolve_email(target_email text)
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
