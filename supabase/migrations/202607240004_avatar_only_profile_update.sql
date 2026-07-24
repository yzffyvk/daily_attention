create or replace function public.update_profile_avatar(
  target_user_id uuid,
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
  set avatar_key = target_avatar_key
  where id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.update_profile_avatar(uuid, smallint) from public, anon, authenticated;
grant execute on function public.update_profile_avatar(uuid, smallint) to service_role;
