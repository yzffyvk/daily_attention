create function public.read_profile(target_user_id uuid)
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

revoke all on function public.read_profile(uuid) from public, anon, authenticated;
grant execute on function public.read_profile(uuid) to service_role;
