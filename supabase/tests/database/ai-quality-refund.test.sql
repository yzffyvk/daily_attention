begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000009611','00000000-0000-0000-0000-000000000000','authenticated','authenticated','quality-refund@internal.invalid','',now(),now(),now());
create function pg_temp.quality_job() returns uuid language plpgsql as $$
declare job_id uuid;
begin
  select (j.job).id into job_id from public.create_ai_generation_job('00000000-0000-4000-8000-000000009611',
    (now() at time zone 'Asia/Shanghai')::date, gen_random_uuid(), 'https://example.com/quality', 'example.com', '') j;
  perform public.claim_ai_generation_job(job_id);
  perform public.begin_ai_generation(job_id);
  return job_id;
end; $$;
create function pg_temp.quality_fail(job_id uuid, retry boolean default false) returns void language plpgsql as $$
begin
  perform public.mark_ai_generation_provider_failure(job_id,'MODEL_OUTPUT_INVALID','AI 返回内容未通过质量校验',retry,2,100,0,100,50,0);
end; $$;
create temporary table quality_cases(name text primary key,id uuid);
insert into quality_cases values('failed',pg_temp.quality_job());
select pg_temp.quality_fail((select id from quality_cases where name='failed'));
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),0,'quality failure without output refunds consumed quota');
select is(public.read_ai_generation_job_state('00000000-0000-4000-8000-000000009611',(select id from quality_cases where name='failed')) #>> '{quota,remaining}','5','polling reports the restored balance');
select ok((select error_message like '%未消耗使用次数%' from private.ai_generation_jobs where id=(select id from quality_cases where name='failed')),'failure explains that no allowance was consumed');
select is((select provider_call_count::integer from private.ai_generation_jobs where id=(select id from quality_cases where name='failed')),2,'actual model usage remains recorded');
select throws_ok($$select pg_temp.quality_fail((select id from quality_cases where name='failed'))$$,'P0001','AI_JOB_INVALID_TRANSITION','replayed failure cannot settle a terminal job again');
select is(public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000009611',(select id from quality_cases where name='failed'),false) #>> '{quota,remaining}','5','cancellation after failure cannot refund twice');

insert into quality_cases values('retry',pg_temp.quality_job());
select pg_temp.quality_fail((select id from quality_cases where name='retry'),true);
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),1,'pending retry keeps one slot');
select public.claim_ai_generation_job((select id from quality_cases where name='retry'));
select public.begin_ai_generation((select id from quality_cases where name='retry'));
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),1,'retry does not charge another slot');
select pg_temp.quality_fail((select id from quality_cases where name='retry'));
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),0,'terminal quality failure after retry refunds once');

insert into quality_cases values('completion',pg_temp.quality_job());
select public.complete_ai_generation_job((select id from quality_cases where name='completion'),false,null,null,null,null,'[]',
 'MODEL_OUTPUT_INVALID','质量失败',1,100,0,100,50,0,'test-model',null,null);
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),0,'legacy completion failure uses the same settlement');

insert into quality_cases values('cancelled',pg_temp.quality_job());
select public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000009611',(select id from quality_cases where name='cancelled'),false);
select throws_ok($$select pg_temp.quality_fail((select id from quality_cases where name='cancelled'))$$,'P0001','AI_JOB_INVALID_TRANSITION','cancellation winning the race rejects late failure');
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),0,'late failure never double refunds cancellation');

insert into quality_cases values('draft',pg_temp.quality_job());
select public.complete_ai_generation_job((select id from quality_cases where name='draft'),true,'学习草稿','有内容的待核对草稿','','资料',
 '["待核对：复核未完成"]',null,null,1,100,0,100,50,0,'test-model',null,decode(repeat('ab',32),'hex'));
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611'),1,'delivered pending-review draft remains charged');

insert into quality_cases values('rollover',pg_temp.quality_job());
insert into private.ai_daily_quotas(user_id,quota_date,consumed_count)
values('00000000-0000-4000-8000-000000009611',(now() at time zone 'Asia/Shanghai')::date-1,1);
update private.ai_generation_jobs set quota_date=(now() at time zone 'Asia/Shanghai')::date-1 where id=(select id from quality_cases where name='rollover');
update private.ai_daily_quotas set consumed_count=1 where user_id='00000000-0000-4000-8000-000000009611' and quota_date=(now() at time zone 'Asia/Shanghai')::date;
select pg_temp.quality_fail((select id from quality_cases where name='rollover'));
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009611' and quota_date=(now() at time zone 'Asia/Shanghai')::date-1),0,'refund uses the original Beijing quota date');
select is(public.read_ai_generation_job_state('00000000-0000-4000-8000-000000009611',(select id from quality_cases where name='rollover')) #>> '{quota,remaining}','4','cross-midnight refund leaves current-day usage intact');
select * from finish();
rollback;
