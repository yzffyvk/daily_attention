alter table public.profiles enable row level security;
alter table public.check_ins enable row level security;

revoke all on public.profiles from anon;
revoke all on public.check_ins from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.check_ins to authenticated;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy check_ins_select_own
on public.check_ins for select to authenticated
using ((select auth.uid()) = user_id);

create policy check_ins_insert_own
on public.check_ins for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy check_ins_update_own
on public.check_ins for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy check_ins_delete_own
on public.check_ins for delete to authenticated
using ((select auth.uid()) = user_id);

create policy checkin_images_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy checkin_images_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy checkin_images_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.complete_registration(
  target_user_id uuid,
  target_login_name text,
  target_auth_email text,
  target_avatar_key smallint,
  target_recovery_digest bytea
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_profile public.profiles;
begin
  insert into public.profiles (id, display_name, avatar_key)
  values (target_user_id, target_login_name, target_avatar_key)
  returning * into created_profile;

  insert into private.login_aliases (
    user_id,
    login_name,
    auth_email,
    recovery_code_digest
  )
  values (
    target_user_id,
    target_login_name,
    target_auth_email,
    target_recovery_digest
  );

  return created_profile;
end;
$$;

create or replace function public.resolve_login_name(target_login_name text)
returns table (user_id uuid, auth_email text)
language sql
security definer
stable
set search_path = ''
as $$
  select aliases.user_id, aliases.auth_email
  from private.login_aliases aliases
  where aliases.login_name = target_login_name::extensions.citext;
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
  update private.login_aliases
  set recovery_code_digest = next_digest,
      recovery_rotated_at = now()
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
  select aliases.recovery_code_digest
  from private.login_aliases aliases
  where aliases.user_id = target_user_id;
$$;

create or replace function public.update_profile_identity(
  target_user_id uuid,
  target_login_name text,
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
  update private.login_aliases
  set login_name = target_login_name::extensions.citext
  where user_id = target_user_id;

  update public.profiles
  set display_name = target_login_name,
      avatar_key = target_avatar_key
  where id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.complete_registration(uuid, text, text, smallint, bytea) from public, anon, authenticated;
revoke all on function public.resolve_login_name(text) from public, anon, authenticated;
revoke all on function public.read_recovery_digest(uuid) from public, anon, authenticated;
revoke all on function public.replace_recovery_digest(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function public.update_profile_identity(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.complete_registration(uuid, text, text, smallint, bytea) to service_role;
grant execute on function public.resolve_login_name(text) to service_role;
grant execute on function public.read_recovery_digest(uuid) to service_role;
grant execute on function public.replace_recovery_digest(uuid, bytea, bytea) to service_role;
grant execute on function public.update_profile_identity(uuid, text, smallint) to service_role;
