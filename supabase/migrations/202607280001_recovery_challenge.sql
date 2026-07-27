create function public.resolve_recovery_challenge(target_email text)
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
