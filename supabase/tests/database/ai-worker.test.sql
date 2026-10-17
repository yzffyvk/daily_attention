begin;
select plan(28);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values (
  '00000000-0000-4000-8000-000000000903',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'ai-worker@internal.invalid',
  '',
  now(),
  now(),
  now()
);

create temporary table worker_jobs (
  slot integer primary key,
  job_id uuid not null
) on commit drop;

insert into worker_jobs (slot, job_id)
select 1, (created.job).id
from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000903',
  '2026-08-02',
  '20000000-0000-4000-8000-000000000001',
  'https://example.com/worker-1',
  'example.com'
) as created;

select function_privs_are(
  'public', 'read_ai_generation_queue', array['integer', 'integer'],
  'authenticated', array[]::text[],
  'authenticated users cannot read the AI queue'
);
select function_privs_are(
  'public', 'read_ai_generation_queue', array['integer', 'integer'],
  'service_role', array['EXECUTE'],
  'service role can read the AI queue'
);
select function_privs_are(
  'public', 'delete_ai_generation_queue_message', array['bigint'],
  'authenticated', array[]::text[],
  'authenticated users cannot delete AI queue messages'
);
select function_privs_are(
  'public', 'delete_ai_generation_queue_message', array['bigint'],
  'service_role', array['EXECUTE'],
  'service role can delete AI queue messages'
);
select function_privs_are(
  'public', 'delay_ai_generation_queue_message', array['bigint', 'integer'],
  'authenticated', array[]::text[],
  'authenticated users cannot delay AI queue messages'
);
select function_privs_are(
  'public', 'delay_ai_generation_queue_message', array['bigint', 'integer'],
  'service_role', array['EXECUTE'],
  'service role can delay AI queue messages'
);

create temporary table queue_delivery on commit drop as
select * from public.read_ai_generation_queue(60, 5);

select results_eq(
  $$select message ->> 'job_id' from queue_delivery$$,
  $$select job_id::text from worker_jobs where slot = 1$$,
  'the narrow queue reader returns the queued job id'
);
select is(
  (select public.delay_ai_generation_queue_message(msg_id, 5) from queue_delivery),
  true,
  'a queue delivery can be delayed without sleeping'
);
select is(
  (select public.delete_ai_generation_queue_message(msg_id) from queue_delivery),
  true,
  'a terminal queue delivery can be deleted'
);

select is(
  (select (claimed).attempt_count::integer
   from public.claim_ai_generation_job((select job_id from worker_jobs where slot = 1)) claimed),
  1,
  'the first claim records attempt one'
);
select is(
  (select (started).status
   from public.begin_ai_generation((select job_id from worker_jobs where slot = 1)) started),
  'generating',
  'the first provider attempt starts generation'
);
select is(
  (select (failed).status
   from public.mark_ai_generation_provider_failure(
     (select job_id from worker_jobs where slot = 1),
     'MODEL_SERVICE_ERROR', 'AI 服务暂时不可用', true,
     1, 100, 20, 80, 50, 10
   ) failed),
  'retryable',
  'a transient provider failure remains retryable'
);
select results_eq(
  $$select status, provider_call_count::integer, prompt_tokens,
           prompt_cache_hit_tokens, prompt_cache_miss_tokens,
           completion_tokens, reasoning_tokens
    from private.ai_generation_jobs
    where id = (select job_id from worker_jobs where slot = 1)$$,
  $$values ('retryable'::varchar, 1, 100, 20, 80, 50, 10)$$,
  'provider failure usage is retained without generated content'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000903'$$,
  $$values (0, 1)$$,
  'a provider retry does not refund consumed quota'
);
select is(
  (select (claimed).attempt_count::integer
   from public.claim_ai_generation_job((select job_id from worker_jobs where slot = 1)) claimed),
  2,
  'the retry claim records attempt two'
);
select is(
  (select (started).status
   from public.begin_ai_generation((select job_id from worker_jobs where slot = 1)) started),
  'generating',
  'a retry can begin without consuming quota twice'
);
select is(
  (select (completed).status
   from public.complete_ai_generation_job(
     (select job_id from worker_jobs where slot = 1), true,
     '理解注意力机制', '结构化知识小结', '继续比较不同架构', '示例资料',
     '[]'::jsonb, null, null, 1, 110, 30, 80, 60, 20,
     'deepseek-v4-pro', 'fingerprint-2', decode(repeat('ab', 32), 'hex')
   ) completed),
  'succeeded',
  'a later successful attempt completes the job'
);
select results_eq(
  $$select provider_call_count::integer, prompt_tokens,
           prompt_cache_hit_tokens, prompt_cache_miss_tokens,
           completion_tokens, reasoning_tokens
    from private.ai_generation_jobs
    where id = (select job_id from worker_jobs where slot = 1)$$,
  $$values (2, 210, 50, 160, 110, 30)$$,
  'successful completion accumulates usage across provider attempts'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000903'$$,
  $$values (0, 1)$$,
  'a successful retry still consumes only one daily slot'
);

insert into worker_jobs (slot, job_id)
select 2, (created.job).id
from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000903',
  '2026-08-02',
  '20000000-0000-4000-8000-000000000002',
  'https://example.com/worker-2',
  'example.com'
) as created;

select lives_ok(
  $$select * from public.claim_ai_generation_job((select job_id from worker_jobs where slot = 2))$$,
  'an exhaustion fixture can be claimed'
);
select lives_ok(
  $$select * from public.begin_ai_generation((select job_id from worker_jobs where slot = 2))$$,
  'an exhaustion fixture can begin'
);
update private.ai_generation_jobs
set attempt_count = 3
where id = (select job_id from worker_jobs where slot = 2);
select is(
  (select (failed).status
   from public.mark_ai_generation_provider_failure(
     (select job_id from worker_jobs where slot = 2),
     'TASK_RETRY_EXHAUSTED', 'AI 服务多次重试后仍不可用', false,
     1, 0, 0, 0, 0, 0
   ) failed),
  'failed',
  'the final provider attempt becomes terminal'
);
select results_eq(
  $$select error_code, provider_call_count::integer, finished_at is not null
    from private.ai_generation_jobs
    where id = (select job_id from worker_jobs where slot = 2)$$,
  $$values ('TASK_RETRY_EXHAUSTED'::varchar, 1, true)$$,
  'retry exhaustion records a stable terminal error'
);

insert into worker_jobs (slot, job_id)
select 3, (created.job).id
from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000903',
  '2026-08-02',
  '20000000-0000-4000-8000-000000000003',
  'https://example.com/worker-3',
  'example.com'
) as created;

select is(
  (select (claimed).attempt_count::integer
   from public.claim_ai_generation_job((select job_id from worker_jobs where slot = 3)) claimed),
  1,
  'a crash recovery fixture starts at attempt one'
);
select is(
  (select (claimed).attempt_count::integer
   from public.claim_ai_generation_job((select job_id from worker_jobs where slot = 3)) claimed),
  2,
  'a redelivered message can reclaim a stale fetching job'
);
update private.ai_generation_jobs
set attempt_count = 3
where id = (select job_id from worker_jobs where slot = 3);
select is_empty(
  $$select * from public.claim_ai_generation_job((select job_id from worker_jobs where slot = 3))$$,
  'an exhausted stale claim returns no runnable job'
);
select results_eq(
  $$select status, error_code, finished_at is not null
    from private.ai_generation_jobs
    where id = (select job_id from worker_jobs where slot = 3)$$,
  $$values ('failed'::varchar, 'TASK_RETRY_EXHAUSTED'::varchar, true)$$,
  'an exhausted stale job is made terminal instead of remaining stuck'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000903'$$,
  $$values (0, 1)$$,
  'stale exhaustion and previous provider failure each release their original charge'
);

select * from finish();
rollback;
