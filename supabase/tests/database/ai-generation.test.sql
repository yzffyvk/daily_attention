begin;
select plan(40);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'ai-one@internal.invalid',
    '',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'ai-two@internal.invalid',
    '',
    now(),
    now(),
    now()
  );

create temporary table created_ai_jobs (
  slot integer primary key,
  job_id uuid not null
) on commit drop;

select has_table(
  'private',
  'ai_generation_jobs',
  'AI generation jobs table exists'
);
select has_table(
  'private',
  'ai_daily_quotas',
  'AI daily quota table exists'
);
select table_privs_are(
  'private',
  'ai_generation_jobs',
  'anon',
  array[]::text[],
  'anonymous users have no AI job table privileges'
);
select table_privs_are(
  'private',
  'ai_generation_jobs',
  'authenticated',
  array[]::text[],
  'authenticated users have no AI job table privileges'
);
select table_privs_are(
  'private',
  'ai_daily_quotas',
  'anon',
  array[]::text[],
  'anonymous users have no AI quota table privileges'
);
select table_privs_are(
  'private',
  'ai_daily_quotas',
  'authenticated',
  array[]::text[],
  'authenticated users have no AI quota table privileges'
);
select function_privs_are(
  'public',
  'create_ai_generation_job',
  array['uuid', 'date', 'uuid', 'text', 'text', 'text'],
  'authenticated',
  array[]::text[],
  'authenticated users cannot create AI jobs through the service RPC'
);
select function_privs_are(
  'public',
  'create_ai_generation_job',
  array['uuid', 'date', 'uuid', 'text', 'text', 'text'],
  'service_role',
  array['EXECUTE'],
  'service role can create AI jobs'
);

insert into created_ai_jobs (slot, job_id)
select
  slot,
  (created.job).id
from generate_series(1, 5) as slot
cross join lateral public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000901',
  '2026-07-31',
  ('10000000-0000-4000-8000-' || lpad(slot::text, 12, '0'))::uuid,
  'https://example.com/article-' || slot::text,
  'example.com'
) as created;

select is(
  (select count(*)::integer from created_ai_jobs),
  5,
  'five distinct idempotency keys create five jobs'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000901'$$,
  $$values (5, 0)$$,
  'five created jobs reserve all daily slots'
);
select throws_ok(
  $$select * from public.create_ai_generation_job(
    '00000000-0000-4000-8000-000000000901',
    '2026-07-31',
    '10000000-0000-4000-8000-000000000006',
    'https://example.com/article-6',
    'example.com'
  )$$,
  'P0001',
  'DAILY_AI_LIMIT_REACHED',
  'a sixth occupied slot is rejected'
);
select is(
  (
    select (created.job).id
    from public.create_ai_generation_job(
      '00000000-0000-4000-8000-000000000901',
      '2026-07-31',
      '10000000-0000-4000-8000-000000000001',
      'https://example.com/article-1',
      'example.com'
    ) as created
  ),
  (select job_id from created_ai_jobs where slot = 1),
  'repeating an idempotency key returns the original job'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000901'$$,
  $$values (5, 0)$$,
  'idempotent creation does not occupy another slot'
);
select is(
  (select count(*)::integer from pgmq.q_ai_generation_jobs where message->>'job_id' in (select job_id::text from created_ai_jobs)),
  5,
  'one queue message is sent for each created job'
);
select ok(
  (
    select pg_catalog.bool_and(
      (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(message)) = 1
      and message ? 'job_id'
    )
    from pgmq.q_ai_generation_jobs
    where message->>'job_id' in (select job_id::text from created_ai_jobs)
  ),
  'queue payloads contain only job_id'
);

select is(
  (
    select (cancelled.job).status
    from public.cancel_ai_generation_job(
      '00000000-0000-4000-8000-000000000901',
      (select job_id from created_ai_jobs where slot = 5)
    ) as cancelled
  ),
  'cancelled',
  'queued jobs can be cancelled'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000901'$$,
  $$values (4, 0)$$,
  'queued cancellation releases one reservation'
);

insert into created_ai_jobs (slot, job_id)
select
  6,
  (created.job).id
from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000901',
  '2026-07-31',
  '10000000-0000-4000-8000-000000000006',
  'https://example.com/article-6',
  'example.com'
) as created;

select is(
  (
    select (claimed).status
    from public.claim_ai_generation_job(
      (select job_id from created_ai_jobs where slot = 6)
    ) as claimed
  ),
  'fetching',
  'worker claim moves a queued job to fetching'
);
select is(
  (
    select (failed).status
    from public.mark_ai_generation_fetch_failure(
      (select job_id from created_ai_jobs where slot = 6),
      'CONTENT_NOT_EXTRACTABLE',
      '无法从该页面提取正文',
      false
    ) as failed
  ),
  'failed',
  'permanent fetch failure marks the job failed'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000901'$$,
  $$values (4, 0)$$,
  'permanent fetch failure releases its reservation'
);

select is(
  (
    select (claimed).attempt_count::integer
    from public.claim_ai_generation_job(
      (select job_id from created_ai_jobs where slot = 1)
    ) as claimed
  ),
  1,
  'a first worker claim records attempt one'
);
select is(
  (
    select (started).status
    from public.begin_ai_generation(
      (select job_id from created_ai_jobs where slot = 1)
    ) as started
  ),
  'generating',
  'begin moves a fetched job to generating'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000901'$$,
  $$values (3, 1)$$,
  'begin moves exactly one reservation to consumed'
);
select throws_ok(
  $$select * from public.begin_ai_generation(
    (select job_id from created_ai_jobs where slot = 1)
  )$$,
  'P0001',
  'AI_JOB_INVALID_TRANSITION',
  'begin cannot consume the same job twice'
);
select is(
  (
    select (completed).status
    from public.complete_ai_generation_job(
      (select job_id from created_ai_jobs where slot = 1),
      false,
      null,
      null,
      null,
      null,
      '[]'::jsonb,
      'MODEL_SERVICE_ERROR',
      'AI 服务暂时不可用',
      1,
      null,
      null,
      null,
      null,
      null,
      'deepseek-v4-pro',
      null,
      null
    ) as completed
  ),
  'failed',
  'provider failure after begin reaches a terminal failure'
);
select results_eq(
  $$select reserved_count::integer, consumed_count::integer
    from private.ai_daily_quotas
    where user_id = '00000000-0000-4000-8000-000000000901'$$,
  $$values (3, 1)$$,
  'provider failure after begin does not refund consumed quota'
);
select is_empty(
  $$select * from public.read_ai_generation_job(
    '00000000-0000-4000-8000-000000000902',
    (select job_id from created_ai_jobs where slot = 2)
  )$$,
  'wrong-owner reads reveal no job'
);
select throws_ok(
  $$select * from public.cancel_ai_generation_job(
    '00000000-0000-4000-8000-000000000902',
    (select job_id from created_ai_jobs where slot = 2)
  )$$,
  'P0001',
  'FORBIDDEN_JOB',
  'wrong-owner cancellation fails without revealing job state'
);
select throws_ok(
  $$select * from public.cancel_ai_generation_job(
    '00000000-0000-4000-8000-000000000901',
    (select job_id from created_ai_jobs where slot = 1)
  )$$,
  'P0001',
  'AI_JOB_INVALID_TRANSITION',
  'terminal jobs cannot be cancelled'
);
select is_empty(
  $$select * from public.claim_ai_generation_job(
    (select job_id from created_ai_jobs where slot = 1)
  )$$,
  'terminal jobs cannot be claimed again'
);

select is(
  (
    select (claimed).status
    from public.claim_ai_generation_job(
      (select job_id from created_ai_jobs where slot = 2)
    ) as claimed
  ),
  'fetching',
  'a second job can be claimed for a successful provider call'
);
select is(
  (
    select (started).status
    from public.begin_ai_generation(
      (select job_id from created_ai_jobs where slot = 2)
    ) as started
  ),
  'generating',
  'the second job begins generation'
);
select is(
  (
    select (completed).status
    from public.complete_ai_generation_job(
      (select job_id from created_ai_jobs where slot = 2),
      true,
      '理解注意力机制',
      '结构化知识小结',
      '继续比较不同架构',
      '示例资料',
      '["资料可能不完整"]'::jsonb,
      null,
      null,
      1,
      100,
      20,
      80,
      50,
      10,
      'deepseek-v4-pro',
      'fingerprint-1',
      decode(repeat('ab', 32), 'hex')
    ) as completed
  ),
  'succeeded',
  'valid provider output completes the job'
);

update private.ai_generation_jobs
set result_expires_at = '0001-01-01'::timestamptz
where id = (select job_id from created_ai_jobs where slot = 2);

create temporary table expected_ai_expiry as select
  (select count(*)::integer from (select id from private.ai_generation_jobs where status in ('succeeded','failed','cancelled') and result_expires_at<=now() order by result_expires_at,id limit 100) due) cleared_results,
  (select count(*)::integer from (select id from private.ai_generation_jobs where status in ('succeeded','failed','cancelled') and metadata_expires_at<=now() order by metadata_expires_at,id limit 100) due) deleted_jobs;
select results_eq(
  $$select cleared_results, deleted_jobs from public.expire_ai_generation_data(100)$$,
  $$select cleared_results, deleted_jobs from expected_ai_expiry$$,
  'result expiry reports the due batch including this fixture on a populated database'
);
select results_eq(
  $$select attention, summary, inspiration, source_title
    from private.ai_generation_jobs
    where id = (select job_id from created_ai_jobs where slot = 2)$$,
  $$values (null::varchar, null::text, null::text, null::varchar)$$,
  'expired generated text is removed'
);

select is(
  (
    select (cancelled.job).status
    from public.cancel_ai_generation_job(
      '00000000-0000-4000-8000-000000000901',
      (select job_id from created_ai_jobs where slot = 3)
    ) as cancelled
  ),
  'cancelled',
  'another queued job can be made terminal for metadata expiry'
);
update private.ai_generation_jobs
set metadata_expires_at = '0001-01-01'::timestamptz
where id in (
  (select job_id from created_ai_jobs where slot = 3),
  (select job_id from created_ai_jobs where slot = 4)
);

truncate expected_ai_expiry;
insert into expected_ai_expiry select
  (select count(*)::integer from (select id from private.ai_generation_jobs where status in ('succeeded','failed','cancelled') and result_expires_at<=now() order by result_expires_at,id limit 100) due),
  (select count(*)::integer from (select id from private.ai_generation_jobs where status in ('succeeded','failed','cancelled') and metadata_expires_at<=now() order by metadata_expires_at,id limit 100) due);
select results_eq(
  $$select cleared_results, deleted_jobs from public.expire_ai_generation_data(100)$$,
  $$select cleared_results, deleted_jobs from expected_ai_expiry$$,
  'metadata expiry reports the due terminal batch on a populated database'
);
select results_eq(
  $$select
      exists (
        select 1 from private.ai_generation_jobs
        where id = (select job_id from created_ai_jobs where slot = 3)
      ),
      exists (
        select 1 from private.ai_generation_jobs
        where id = (select job_id from created_ai_jobs where slot = 4)
      )$$,
  $$values (false, true)$$,
  'metadata cleanup preserves nonterminal jobs'
);

select function_privs_are(
  'public',
  'expire_ai_generation_data',
  array['integer'],
  'authenticated',
  array[]::text[],
  'authenticated users cannot run AI metadata cleanup'
);
select function_privs_are(
  'public',
  'expire_ai_generation_data',
  array['integer'],
  'service_role',
  array['EXECUTE'],
  'service role can run AI metadata cleanup'
);

select * from finish();
rollback;
