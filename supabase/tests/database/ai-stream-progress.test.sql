begin;
select plan(10);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000973', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ai-stream@internal.invalid', '', now(), now(), now());
create temporary table stream_job as
select (created.job).* from public.create_ai_generation_job(
  '00000000-0000-4000-8000-000000000973', '2026-10-13',
  '10000000-0000-4000-8000-000000000973', 'https://example.com/stream', 'example.com', ''
) created;
select is(public.report_ai_generation_progress((select id from stream_job), 1,
  '{"phase":"writing","preview":"正文","updatedAt":"2026-10-13T12:00:00Z"}'), false, 'queued jobs cannot receive preview');
do $$ begin
  perform public.claim_ai_generation_job((select id from stream_job));
  perform public.begin_ai_generation((select id from stream_job));
end $$;
select is(public.report_ai_generation_progress((select id from stream_job), 1,
  '{"phase":"writing","preview":"正文","updatedAt":"2026-10-13T12:00:00Z"}'), true, 'current attempt can publish preview');
select is((select progress->>'preview' from public.read_ai_generation_job('00000000-0000-4000-8000-000000000973', (select id from stream_job))), '正文', 'owner reads preview through existing RPC');
select is_empty($$select progress from public.read_ai_generation_job('00000000-0000-4000-8000-000000000974', (select id from stream_job))$$, 'other user cannot read preview');
select is(public.report_ai_generation_progress((select id from stream_job), 2,
  '{"phase":"writing","preview":"过时内容","updatedAt":"2026-10-13T12:00:00Z"}'), false, 'wrong attempt cannot replace preview');
select throws_ok($$select public.report_ai_generation_progress((select id from stream_job), 1, '{"phase":"writing","preview":"正文","updatedAt":"x","reasoning":"private"}')$$,
  'P0001', 'AI_PROGRESS_INVALID', 'unexpected fields rejected');
select ok(not has_function_privilege('authenticated', 'public.report_ai_generation_progress(uuid, integer, jsonb)', 'execute'), 'users cannot publish previews');
select ok(not has_function_privilege('anon', 'public.report_ai_generation_progress(uuid, integer, jsonb)', 'execute'), 'anonymous callers cannot publish previews');
update private.ai_generation_jobs set status = 'retryable' where id = (select id from stream_job);
select is((select progress from private.ai_generation_jobs where id = (select id from stream_job)), null::jsonb, 'retry clears incomplete content');
select is(public.report_ai_generation_progress((select id from stream_job), 1,
  '{"phase":"writing","preview":"过时内容","updatedAt":"2026-10-13T12:00:00Z"}'), false, 'late writes cannot restore cleared preview');
select * from finish();
rollback;
