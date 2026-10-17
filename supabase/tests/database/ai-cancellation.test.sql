begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000976', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-cancel@internal.invalid', '', now(), now(), now()),
       ('00000000-0000-4000-8000-000000000977', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-cancel-rollover@internal.invalid', '', now(), now(), now());

create function pg_temp.cancel_job(wanted_status text, owner_id uuid default '00000000-0000-4000-8000-000000000976')
returns uuid language plpgsql as $$
declare job_id uuid;
begin
  select (created.job).id into job_id from public.create_ai_generation_job(owner_id, (now() at time zone 'Asia/Shanghai')::date, gen_random_uuid(), 'https://example.com/cancel', 'example.com', '') created;
  if wanted_status <> 'queued' then perform public.claim_ai_generation_job(job_id); end if;
  if wanted_status in ('generating', 'retryable', 'succeeded') then perform public.begin_ai_generation(job_id); end if;
  if wanted_status = 'retryable' then update private.ai_generation_jobs set status = 'retryable' where id = job_id; end if;
  if wanted_status = 'succeeded' then
    update private.ai_generation_jobs set status = 'succeeded', finished_at = now(), result_expires_at = now() + interval '24 hours',
      attention = '已完成', summary = '完整结果', inspiration = '', source_title = '资料' where id = job_id;
  end if;
  return job_id;
end;
$$;
create temporary table cancel_cases (name text primary key, id uuid, response jsonb);
insert into cancel_cases values ('queued', pg_temp.cancel_job('queued'), null);
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, false) where name = 'queued';
select is((select response #>> '{job,status}' from cancel_cases where name='queued'), 'cancelled', 'queued job cancels');
select is((select response #>> '{cancellation,freeRemaining}' from cancel_cases where name='queued'), '2', 'queued cancellation preserves free chances');
select is((select response #>> '{quota,remaining}' from cancel_cases where name='queued'), '2', 'queued cancellation releases reservation');

insert into cancel_cases values ('fetching', pg_temp.cancel_job('fetching'), null);
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, false) where name='fetching';
select is((select response #>> '{cancellation,freeRemaining}' from cancel_cases where name='fetching'), '2', 'reading cancellation preserves free chances');
select is((select response #>> '{quota,remaining}' from cancel_cases where name='fetching'), '2', 'reading cancellation releases reservation');

insert into cancel_cases values ('first', pg_temp.cancel_job('generating'), null);
update private.ai_generation_jobs set progress = '{"phase":"writing","preview":"未完成","updatedAt":"2026-10-14T00:00:00Z"}' where id=(select id from cancel_cases where name='first');
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, false) where name='first';
select is((select response #>> '{cancellation,freeRemaining}' from cancel_cases where name='first'), '1', 'first model cancellation spends one free chance');
select is((select response #>> '{cancellation,charged}' from cancel_cases where name='first'), 'false', 'first cancellation is free');
select is((select response #>> '{quota,remaining}' from cancel_cases where name='first'), '2', 'first cancellation refunds consumed quota');
select is((select progress from private.ai_generation_jobs where id=(select id from cancel_cases where name='first')), null::jsonb, 'cancelled preview clears');
select is(public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', (select id from cancel_cases where name='first'), false) #>> '{cancellation,freeRemaining}', '1', 'repeated cancellation does not spend another chance');

insert into cancel_cases values ('second', pg_temp.cancel_job('generating'), null);
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, false) where name='second';
select is((select response #>> '{cancellation,freeRemaining}' from cancel_cases where name='second'), '0', 'second model cancellation uses final free chance');
select is((select response #>> '{quota,remaining}' from cancel_cases where name='second'), '2', 'second cancellation refunds consumed quota');

insert into cancel_cases values ('third', pg_temp.cancel_job('generating'), null);
select throws_ok($$select public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', (select id from cancel_cases where name='third'), false)$$,
  'P0001', 'CANCELLATION_CONFIRMATION_REQUIRED', 'third cancellation requires explicit charge confirmation');
select is((select status from private.ai_generation_jobs where id=(select id from cancel_cases where name='third')), 'generating', 'confirmation does not cancel ongoing generation');
select is(public.read_ai_generation_job_state('00000000-0000-4000-8000-000000000976', (select id from cancel_cases where name='third')) #>> '{cancellation,requiresConfirmation}', 'true', 'owner sees charge confirmation policy');
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, true) where name='third';
select is((select response #>> '{cancellation,charged}' from cancel_cases where name='third'), 'true', 'confirmed third cancellation remains charged');
select is((select response #>> '{quota,consumed}' from cancel_cases where name='third'), '1', 'charged cancellation does not charge twice');
select is(public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', (select id from cancel_cases where name='third'), true) #>> '{quota,consumed}', '1', 'repeated paid cancellation does not charge twice');
select is(public.read_ai_generation_job_execution_status((select id from cancel_cases where name='third')), 'cancelled', 'worker can detect cancelled execution');

insert into cancel_cases values ('retry', pg_temp.cancel_job('retryable'), null);
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, true) where name='retry';
select is((select response #>> '{job,status}' from cancel_cases where name='retry'), 'cancelled', 'waiting retry can be cancelled');
select is((select response #>> '{quota,consumed}' from cancel_cases where name='retry'), '2', 'model retry cancellation preserves its single consumed slot');

select public.payment_create_credit_order('cancel-credit-order','cancel-owner',
 '00000000-0000-4000-8000-000000000976','app','ai_1','sandbox','cancel-credit-key');
select public.payment_apply_event('cancel-credit-order','cancel-trade','PAID','cancel-paid','payment');
insert into cancel_cases values ('complete', pg_temp.cancel_job('succeeded'), null);
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000976', id, false) where name='complete';
select is((select response #>> '{job,status}' from cancel_cases where name='complete'), 'succeeded', 'completion winning race returns completed result');
select is((select response #>> '{quota,consumed}' from cancel_cases where name='complete'), '3', 'completed result is not refunded');
select throws_ok($$select public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000977', (select id from cancel_cases where name='complete'), false)$$,
 'P0001', 'FORBIDDEN_JOB', 'foreign cancellation reveals no result');
select is(public.read_ai_generation_job_state('00000000-0000-4000-8000-000000000977', (select id from cancel_cases where name='complete')), null::jsonb, 'foreign state is absent');

insert into private.ai_cancel_daily_allowances values ('00000000-0000-4000-8000-000000000977', (now() at time zone 'Asia/Shanghai')::date - 1, 2);
insert into cancel_cases values ('rollover', pg_temp.cancel_job('generating','00000000-0000-4000-8000-000000000977'), null);
insert into private.ai_daily_quotas(user_id, quota_date, consumed_count) values ('00000000-0000-4000-8000-000000000977', (now() at time zone 'Asia/Shanghai')::date - 1, 1);
update private.ai_generation_jobs set quota_date=(now() at time zone 'Asia/Shanghai')::date - 1 where id=(select id from cancel_cases where name='rollover');
update private.ai_daily_quotas set consumed_count=0 where user_id='00000000-0000-4000-8000-000000000977' and quota_date=(now() at time zone 'Asia/Shanghai')::date;
update cancel_cases set response = public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000000977', id, false) where name='rollover';
select is((select response #>> '{cancellation,freeRemaining}' from cancel_cases where name='rollover'), '1', 'Beijing new day gets two new free chances');
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000000977' and quota_date=(now() at time zone 'Asia/Shanghai')::date - 1), 0, 'refund credits original task quota day');
select is((select response #>> '{quota,remaining}' from cancel_cases where name='rollover'), '2', 'response shows current day quota');

select ok(not has_function_privilege('authenticated','public.cancel_ai_generation_job_v2(uuid,uuid,boolean)','execute'), 'users cannot call privileged cancellation directly');
select ok(not has_function_privilege('anon','public.cancel_ai_generation_job_v2(uuid,uuid,boolean)','execute'), 'anonymous callers cannot cancel');
select ok(not has_function_privilege('authenticated','public.read_ai_generation_job_execution_status(uuid)','execute'), 'users cannot read global execution status');
select ok((select relrowsecurity from pg_class where oid='private.ai_cancel_daily_allowances'::regclass), 'private allowance table has RLS');
select * from finish();
rollback;
