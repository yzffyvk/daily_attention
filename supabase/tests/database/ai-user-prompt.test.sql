begin;
select plan(34);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000971', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-prompt@internal.invalid', '', now(), now(), now());

create temporary table prompt_job as
select (created.job).* from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-23',
  '10000000-0000-4000-8000-000000000971', 'https://example.com/prompt', 'example.com', '  聚焦实现  '
) created;

select is((select user_prompt from prompt_job), '聚焦实现', 'job snapshots the normalized prompt');
select is((select prompt_version::text from prompt_job), 'knowledge-questions-v1', 'new jobs snapshot the current prompt version');
select is((select (created.job).id from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-23',
  '10000000-0000-4000-8000-000000000971', 'https://example.com/prompt', 'example.com', '聚焦实现'
) created), (select id from prompt_job), 'same normalized request reuses its job');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id = '00000000-0000-4000-8000-000000000971'), 1, 'replay reserves only one quota slot');

select throws_ok($$select * from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-23',
  '10000000-0000-4000-8000-000000000971', 'https://example.com/prompt', 'example.com', '改动要求'
)$$, 'P0001', 'AI_IDEMPOTENCY_CONFLICT', 'changed prompt conflicts');
select throws_ok($$select * from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-24',
  '10000000-0000-4000-8000-000000000971', 'https://example.com/prompt', 'example.com', '聚焦实现'
)$$, 'P0001', 'AI_IDEMPOTENCY_CONFLICT', 'changed date conflicts');
select throws_ok($$select * from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-23',
  '10000000-0000-4000-8000-000000000971', 'https://example.com/changed', 'example.com', '聚焦实现'
)$$, 'P0001', 'AI_IDEMPOTENCY_CONFLICT', 'changed URL conflicts');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id = '00000000-0000-4000-8000-000000000971'), 1, 'conflicts do not reserve quota');
select is((select (created.job).user_prompt from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-23',
  '10000000-0000-4000-8000-000000000972', 'https://example.com/legacy', 'example.com'
) created), '', 'legacy five-argument calls default to an empty prompt');
select throws_ok($$select * from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000971', '2026-09-23',
  '10000000-0000-4000-8000-000000000973', 'https://example.com/too-long', 'example.com', repeat('长', 1001)
)$$, '22023', 'invalid AI generation job', 'overlong job prompts fail before reserving quota');
select is((select user_prompt from public.read_ai_generation_job('00000000-0000-4000-8000-000000000971', (select id from prompt_job))), '聚焦实现', 'owner reads retain the snapshot');
select is((select user_prompt from public.claim_ai_generation_job((select id from prompt_job))), '聚焦实现', 'worker claims include the snapshot');
select throws_ok($$update private.ai_generation_jobs set user_prompt = 'rewrite' where id = (select id from prompt_job)$$,
  'P0001', 'AI_GENERATION_CONTEXT_IMMUTABLE', 'job prompts are immutable');
select throws_ok($$update private.ai_generation_jobs set prompt_version = 'rewrite' where id = (select id from prompt_job)$$,
  'P0001', 'AI_GENERATION_CONTEXT_IMMUTABLE', 'job versions are immutable');
select is((select user_prompt from public.mark_ai_generation_fetch_failure((select id from prompt_job), 'FETCH_TIMEOUT', 'timeout', true)), '聚焦实现', 'retry preserves the prompt snapshot');
update private.ai_generation_jobs set metadata_expires_at = now() - interval '1 minute' where id = (select id from prompt_job);
do $$ begin perform public.expire_ai_generation_data(100); end $$;
select is((select user_prompt from private.ai_generation_jobs where id = (select id from prompt_job)), '聚焦实现', 'cleanup preserves retryable job metadata');
select is((select user_prompt from public.claim_ai_generation_job((select id from prompt_job))), '聚焦实现', 'retry receives the same prompt');
select * from public.mark_ai_generation_fetch_failure((select id from prompt_job), 'CONTENT_BLOCKED', 'blocked', false);
do $$ begin perform public.expire_ai_generation_data(100); end $$;
select is_empty($$select id from private.ai_generation_jobs where id = (select id from prompt_job)$$, 'terminal metadata expiry deletes the prompt with its job');

insert into private.ai_generation_jobs (user_id, quota_date, target_date, idempotency_key, source_url, source_host, prompt_version, user_prompt,
  status, finished_at, result_expires_at)
values ('00000000-0000-4000-8000-000000000971', (now() at time zone 'Asia/Shanghai')::date, '2026-09-23',
  '10000000-0000-4000-8000-000000000974', 'https://example.com/old-job', 'example.com', 'ai-summary-v1', '',
  'cancelled', now(), now() - interval '1 minute');
do $$ begin perform public.expire_ai_generation_data(100); end $$;
select results_eq($$select user_prompt, prompt_version::text from private.ai_generation_jobs where idempotency_key = '10000000-0000-4000-8000-000000000974'$$,
  $$values (''::text, 'ai-summary-v1'::text)$$, 'result expiry preserves old version snapshots until metadata expiry');

insert into public.check_ins (user_id, checkin_date, entry_mode, attention, user_prompt, ai_generation_context)
values ('00000000-0000-4000-8000-000000000971', '2026-09-23', 'ai', 'AI', '新要求',
  '{"userPrompt":"旧要求","promptVersion":"knowledge-skeleton-user-prompt-v1"}');
select results_eq($$select user_prompt, ai_generation_context->>'userPrompt' from public.check_ins where entry_mode = 'ai' and user_id = '00000000-0000-4000-8000-000000000971'$$,
  $$values ('新要求'::text, '旧要求'::text)$$, 'record prompt remains independent of generated-content context');
select throws_ok($$update public.check_ins set user_prompt = repeat('长',1001) where user_id = '00000000-0000-4000-8000-000000000971'$$, '23514', null, 'record rejects overlong prompts');
select throws_ok($$update public.check_ins set ai_generation_context = '{}' where user_id = '00000000-0000-4000-8000-000000000971'$$, '23514', null, 'context requires both fields');
select throws_ok($$update public.check_ins set ai_generation_context = '{"userPrompt":null,"promptVersion":"v1"}' where user_id = '00000000-0000-4000-8000-000000000971'$$, '23514', null, 'context prompt must be text');
select throws_ok($$update public.check_ins set ai_generation_context = '{"userPrompt":"","promptVersion":"v1","extra":true}' where user_id = '00000000-0000-4000-8000-000000000971'$$, '23514', null, 'context rejects unknown fields');
select throws_ok($$update public.check_ins set ai_generation_context = jsonb_build_object('userPrompt', '', 'promptVersion', repeat('v', 41)) where user_id = '00000000-0000-4000-8000-000000000971'$$, '23514', null, 'context version has a forty-character limit');
select lives_ok($$update public.check_ins set user_prompt = repeat('长',1000) where user_id = '00000000-0000-4000-8000-000000000971'$$, 'record accepts exactly one thousand characters');
select lives_ok($$update public.check_ins set ai_generation_context = null where user_id = '00000000-0000-4000-8000-000000000971'$$, 'legacy context can remain null');
insert into public.check_ins (user_id, checkin_date, entry_mode, attention, user_prompt, ai_generation_context)
values ('00000000-0000-4000-8000-000000000971', '2026-09-23', 'manual', '手写', '忽略', '{"userPrompt":"忽略","promptVersion":"v1"}');
select results_eq($$select user_prompt, ai_generation_context from public.check_ins where entry_mode = 'manual' and user_id = '00000000-0000-4000-8000-000000000971'$$,
  $$values (''::text, null::jsonb)$$, 'manual inserts clear AI context');
update public.check_ins set user_prompt = '忽略', ai_generation_context = '{"userPrompt":"忽略","promptVersion":"v1"}'
where user_id = '00000000-0000-4000-8000-000000000971' and entry_mode = 'manual';
select results_eq($$select user_prompt, ai_generation_context from public.check_ins where entry_mode = 'manual' and user_id = '00000000-0000-4000-8000-000000000971'$$,
  $$values (''::text, null::jsonb)$$, 'manual updates clear AI context');

select function_privs_are('public', 'create_ai_generation_job', array['uuid','date','uuid','text','text','text'], 'anon', array[]::text[], 'anonymous users cannot create jobs');
select function_privs_are('public', 'create_ai_generation_job', array['uuid','date','uuid','text','text','text'], 'authenticated', array[]::text[], 'authenticated users cannot invoke service RPC');
select function_privs_are('public', 'create_ai_generation_job', array['uuid','date','uuid','text','text','text'], 'service_role', array['EXECUTE'], 'service role can create jobs');
select is_empty($$select * from public.read_ai_generation_job('00000000-0000-4000-8000-000000000972', (select id from private.ai_generation_jobs where user_id = '00000000-0000-4000-8000-000000000971' limit 1))$$, 'another user cannot read private prompts');
select is((select count(*)::integer from pgmq.q_ai_generation_jobs where message ? 'user_prompt'), 0, 'queue messages do not copy private prompt text');

select * from finish();
rollback;
