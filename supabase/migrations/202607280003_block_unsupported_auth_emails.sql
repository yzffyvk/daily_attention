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
