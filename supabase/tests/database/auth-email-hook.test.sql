begin;
select plan(26);

select has_function(
  'private',
  'block_unsupported_auth_emails',
  array['jsonb'],
  'the Send Email Hook function exists'
);
select function_returns(
  'private',
  'block_unsupported_auth_emails',
  array['jsonb'],
  'jsonb',
  'the Send Email Hook returns jsonb'
);
select is(
  (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'block_unsupported_auth_emails'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'jsonb'
  ),
  false,
  'the Send Email Hook is security invoker'
);
select is(
  (
    select setting
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.unnest(procedure.proconfig) as config(setting)
    where namespace.nspname = 'private'
      and procedure.proname = 'block_unsupported_auth_emails'
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'jsonb'
      and setting = 'search_path=""'
  ),
  'search_path=""',
  'the Send Email Hook has an empty search path'
);

select is(
  private.block_unsupported_auth_emails(
    jsonb_build_object('email_data', jsonb_build_object('email_action_type', action_type))
  ),
  '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb,
  format('the Send Email Hook blocks %s', action_type)
)
from (
  values
    ('signup'),
    ('invite'),
    ('magiclink'),
    ('recovery'),
    ('email_change'),
    ('email'),
    ('reauthentication')
) blocked(action_type);

select is(
  private.block_unsupported_auth_emails(
    jsonb_build_object('email_data', jsonb_build_object('email_action_type', action_type))
  ),
  '{}'::jsonb,
  format('the Send Email Hook allows notification-only action %s', action_type)
)
from (
  values
    ('password_changed_notification'),
    ('email_changed_notification'),
    ('phone_changed_notification'),
    ('identity_linked_notification'),
    ('identity_unlinked_notification'),
    ('mfa_factor_enrolled_notification'),
    ('mfa_factor_unenrolled_notification')
) allowed(action_type);

select is(
  private.block_unsupported_auth_emails(null),
  '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb,
  'the Send Email Hook fails closed for a null event'
);
select is(
  private.block_unsupported_auth_emails('{}'::jsonb),
  '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb,
  'the Send Email Hook fails closed when email data is absent'
);
select is(
  private.block_unsupported_auth_emails('{"email_data":{"email_action_type":null}}'::jsonb),
  '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb,
  'the Send Email Hook fails closed for a null action type'
);
select is(
  private.block_unsupported_auth_emails('{"email_data":{"email_action_type":42}}'::jsonb),
  '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb,
  'the Send Email Hook fails closed for a non-string action type'
);
select is(
  private.block_unsupported_auth_emails('{"email_data":{"email_action_type":"future_action"}}'::jsonb),
  '{"error":{"http_code":403,"message":"This authentication email flow is unavailable."}}'::jsonb,
  'the Send Email Hook fails closed for an unknown action type'
);

select ok(
  has_schema_privilege('supabase_auth_admin', 'private', 'USAGE'),
  'Supabase Auth can use the private schema'
);
select ok(
  has_function_privilege(
    'supabase_auth_admin',
    'private.block_unsupported_auth_emails(jsonb)',
    'EXECUTE'
  ),
  'Supabase Auth can execute the Send Email Hook'
);
select ok(
  not has_function_privilege('anon', 'private.block_unsupported_auth_emails(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.block_unsupported_auth_emails(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.block_unsupported_auth_emails(jsonb)', 'EXECUTE'),
  'application roles cannot execute the Send Email Hook'
);

select * from finish();
rollback;
