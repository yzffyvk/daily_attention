-- Transaction-only database smoke test. No model calls and no retained test data.
-- Run against the intended project after applying the reconciliation migration.
-- Do not remove BEGIN/ROLLBACK or reuse real user IDs.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $smoke$
declare
  user_one uuid := gen_random_uuid();
  user_two uuid := gen_random_uuid();
  first_key uuid := gen_random_uuid();
  first_job uuid;
  second_job uuid;
  created public.ai_generation_job_with_quota;
  repeated public.ai_generation_job_with_quota;
  quota_row private.ai_daily_quotas%rowtype;
  row_count integer;
  slot integer;
begin
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.complete_registration(uuid,text,smallint,bytea)')
      and proargnames[2] = 'target_email'
  ) then
    raise exception 'SMOKE_REGISTRATION_SIGNATURE';
  end if;
  if to_regprocedure('public.resolve_phone(text)') is not null then
    raise exception 'SMOKE_LEGACY_PHONE_RPC';
  end if;
  if has_table_privilege('authenticated','public.profiles','update')
    or has_table_privilege('authenticated','public.check_ins','truncate')
    or has_schema_privilege('authenticated','private','usage')
    or has_schema_privilege('anon','private','usage')
  then
    raise exception 'SMOKE_EXCESSIVE_TABLE_PRIVILEGES';
  end if;

  insert into auth.users (id,aud,role,email,created_at,updated_at)
  values
    (user_one,'authenticated','authenticated','migration-' || user_one || '@internal.invalid',now(),now()),
    (user_two,'authenticated','authenticated','migration-' || user_two || '@internal.invalid',now(),now());

  insert into public.profiles (id,email,display_name,avatar_key)
  values (user_one,'migration-' || user_one || '@internal.invalid','Migration test',1);

  begin
    insert into public.profiles (id,email,display_name,avatar_key)
    values (user_two,'NOT-AN-EMAIL','Invalid test',1);
    raise exception 'SMOKE_INVALID_EMAIL_ACCEPTED';
  exception when check_violation then null;
  end;
  insert into public.profiles (id,email,display_name,avatar_key)
  values (user_two,'migration-' || user_two || '@internal.invalid','Migration other',2);

  perform public.complete_profile_onboarding(user_one,'Migration ready',1::smallint);
  if not (select onboarding_completed from public.profiles where id=user_one) then
    raise exception 'SMOKE_ONBOARDING';
  end if;

  insert into public.check_ins(user_id,checkin_date,attention)
  values(user_one,current_date,'Migration fixture one'),
        (user_two,current_date,'Migration fixture two');
  begin
    insert into public.check_ins(user_id,checkin_date,attention)
    values(user_one,current_date,'Duplicate fixture');
    raise exception 'SMOKE_DUPLICATE_CHECKIN_ACCEPTED';
  exception when unique_violation then null;
  end;

  select * into created from public.create_ai_generation_job(
    user_one,current_date,first_key,'https://example.com/migration-fixture','example.com');
  first_job := (created.job).id;
  select * into repeated from public.create_ai_generation_job(
    user_one,current_date,first_key,'https://example.com/migration-fixture','example.com');
  if (repeated.job).id is distinct from first_job or repeated.quota_used <> 1 then
    raise exception 'SMOKE_AI_IDEMPOTENCY';
  end if;

  for slot in 2..5 loop
    select * into created from public.create_ai_generation_job(
      user_one,current_date,gen_random_uuid(),'https://example.com/migration-fixture','example.com');
    if slot=2 then second_job := (created.job).id; end if;
  end loop;
  if created.quota_used<>5 or created.quota_remaining<>0 then
    raise exception 'SMOKE_AI_QUOTA_FIVE';
  end if;
  begin
    perform public.create_ai_generation_job(
      user_one,current_date,gen_random_uuid(),'https://example.com/migration-fixture','example.com');
    raise exception 'SMOKE_AI_SIXTH_ACCEPTED';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'DAILY_AI_LIMIT_REACHED' then raise; end if;
  end;
  if (select count(*) from pgmq.q_ai_generation_jobs where message->>'job_id'=first_job::text)<>1 then
    raise exception 'SMOKE_QUEUE_ATOMIC_ENQUEUE';
  end if;
  perform public.claim_ai_generation_job(first_job);
  perform public.begin_ai_generation(first_job);
  select * into quota_row from private.ai_daily_quotas
  where user_id=user_one and quota_date=(now() at time zone 'Asia/Shanghai')::date;
  if quota_row.reserved_count<>4 or quota_row.consumed_count<>1 then
    raise exception 'SMOKE_AI_QUOTA_CONSUMPTION';
  end if;
  perform public.cancel_ai_generation_job(user_one,second_job);
  select * into quota_row from private.ai_daily_quotas
  where user_id=user_one and quota_date=(now() at time zone 'Asia/Shanghai')::date;
  if quota_row.reserved_count<>3 or quota_row.consumed_count<>1 then
    raise exception 'SMOKE_AI_CANCEL_RELEASE';
  end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',user_one,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into row_count from public.profiles;
  if row_count<>1 then raise exception 'SMOKE_PROFILE_RLS'; end if;
  select count(*) into row_count from public.check_ins;
  if row_count<>1 then raise exception 'SMOKE_CHECKIN_RLS'; end if;
  if (select total_count from public.get_check_in_stats(current_date))<>1 then
    raise exception 'SMOKE_STATS_RLS';
  end if;
  update public.check_ins set attention='Forbidden cross-user update' where user_id=user_two;
  get diagnostics row_count = row_count;
  if row_count<>0 then raise exception 'SMOKE_CROSS_USER_UPDATE'; end if;
  execute 'reset role';
end;
$smoke$;

select jsonb_build_object(
  'schema_and_privileges','passed',
  'profile_email_constraint','passed',
  'onboarding','passed',
  'checkin_uniqueness','passed',
  'rls_and_statistics','passed',
  'ai_idempotency','passed',
  'ai_daily_limit','passed',
  'ai_queue_and_consumption','passed',
  'ai_cancel_release','passed',
  'persistence','transaction rolled back; no model called'
) as migration_smoke;
rollback;
