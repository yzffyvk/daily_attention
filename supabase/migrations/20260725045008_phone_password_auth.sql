alter table public.profiles
  add column phone varchar(11);

create sequence private.attention_display_name_seq
  minvalue 1
  maxvalue 999
  start 1
  no cycle;

revoke all on sequence private.attention_display_name_seq from public, anon, authenticated;

create table private.account_recovery_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recovery_code_digest bytea not null,
  recovery_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.account_recovery_credentials from public, anon, authenticated;

create trigger account_recovery_credentials_touch_updated_at
before update on private.account_recovery_credentials
for each row execute function private.touch_updated_at();

delete from public.check_ins;
delete from public.profiles;

drop function public.complete_registration(uuid, text, text, smallint, bytea);
drop function public.resolve_login_name(text);
drop function public.update_profile_identity(uuid, text, smallint);
drop function public.update_profile_avatar(uuid, smallint);
drop table private.login_aliases;

alter table public.profiles
  alter column phone set not null,
  add constraint profiles_phone_key unique (phone),
  add constraint profiles_phone_check check (phone ~ '^1[3-9][0-9]{9}$');

create function public.complete_registration(
  target_user_id uuid,
  target_phone text,
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
  display_name_number := pg_catalog.nextval('private.attention_display_name_seq'::regclass);

  insert into public.profiles (id, phone, display_name, avatar_key)
  values (
    target_user_id,
    target_phone,
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

create function public.resolve_phone(target_phone text)
returns table (user_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select profiles.id
  from public.profiles
  where profiles.phone = target_phone;
$$;

create or replace function public.replace_recovery_digest(
  target_user_id uuid,
  expected_digest bytea,
  next_digest bytea
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.account_recovery_credentials
  set recovery_code_digest = next_digest,
      recovery_rotated_at = pg_catalog.now()
  where user_id = target_user_id
    and recovery_code_digest = expected_digest;
  return found;
end;
$$;

create or replace function public.read_recovery_digest(target_user_id uuid)
returns bytea
language sql
security definer
stable
set search_path = ''
as $$
  select credentials.recovery_code_digest
  from private.account_recovery_credentials credentials
  where credentials.user_id = target_user_id;
$$;

create function public.update_profile(
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
revoke all on function public.resolve_phone(text) from public, anon, authenticated;
revoke all on function public.read_recovery_digest(uuid) from public, anon, authenticated;
revoke all on function public.replace_recovery_digest(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function public.update_profile(uuid, text, smallint) from public, anon, authenticated;

grant execute on function public.complete_registration(uuid, text, smallint, bytea) to service_role;
grant execute on function public.resolve_phone(text) to service_role;
grant execute on function public.read_recovery_digest(uuid) to service_role;
grant execute on function public.replace_recovery_digest(uuid, bytea, bytea) to service_role;
grant execute on function public.update_profile(uuid, text, smallint) to service_role;
