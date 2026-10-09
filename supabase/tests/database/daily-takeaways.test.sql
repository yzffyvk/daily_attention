begin;
select no_plan();

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000008101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'takeaway-one@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000008102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'takeaway-two@internal.invalid', '', now(), now(), now());
insert into public.profiles(id, email, display_name, avatar_key)
values ('00000000-0000-4000-8000-000000008101', 'takeaway-one@example.com', '新知测试一', 1),
  ('00000000-0000-4000-8000-000000008102', 'takeaway-two@example.com', '新知测试二', 2);

-- Test content is transaction-local and never published to a real account.
delete from public.daily_takeaway_lessons;
insert into public.daily_takeaway_lessons(id, sequence, version, content, published, reviewed_by, reviewed_at)
select 'tennis-' || lpad(n::text, 2, '0'), n, 1,
  jsonb_build_object('id', 'tennis-' || lpad(n::text, 2, '0'), 'sequence', n, 'version', 1, 'domain', 'tennis',
    'quiz', jsonb_build_object('options', jsonb_build_array('a', 'b'), 'correctIndex', 0)),
  n < 4, case when n < 4 then 'test fixture' end, case when n < 4 then now() end
from generate_series(1,4) n;

select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'currentLesson'->>'id'), 'tennis-01', 'new users start at the first published lesson');
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->>'today'), (clock_timestamp() at time zone 'Asia/Shanghai')::date::text, 'learning date is computed by the database in Beijing time');
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->>'totalLessons')::integer, 3, 'draft lessons stay outside the daily sequence');
select throws_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-02', 1, 'collect')$$, 'P0001', 'TAKEAWAY_PROGRESS_CHANGED', 'cannot jump ahead to an arbitrary lesson');
select throws_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-01', 2, 'collect')$$, 'P0001', 'TAKEAWAY_CONTENT_UPDATED', 'stale content is not silently collected');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-01', 1, 'quiz', 1)$$, 'a wrong quiz answer is recorded');
select is((select correct from public.daily_takeaway_quiz_results where user_id='00000000-0000-4000-8000-000000008101'), false, 'correctness is calculated server-side');
select is((select count(*)::integer from public.daily_takeaway_progress), 0, 'answering does not complete a lesson');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-01', 1, 'skip')$$, 'known material can be skipped');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-01', 1, 'skip')$$, 'retrying the same skip does not skip another lesson');
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'currentLesson'->>'id'), 'tennis-02', 'skipping advances the personal sequence');
select is(jsonb_array_length(public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'history'), 0, 'skips do not increase collection count');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-02', 1, 'collect')$$, 'collection does not require a quiz');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-02', 1, 'collect')$$, 'collection is idempotent across retries');
select is(jsonb_array_length(public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'history'), 1, 'duplicates are counted only once');
select throws_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-03', 1, 'collect')$$, 'P0001', 'DAILY_TAKEAWAY_DONE', 'a second collection on the same day is rejected');
select throws_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-03', 1, 'skip')$$, 'P0001', 'DAILY_TAKEAWAY_DONE', 'skipping is closed after today is complete');
select is((select count(*)::integer from public.check_ins where user_id='00000000-0000-4000-8000-000000008101'), 0, 'daily takeaway does not write check-ins');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-02', 1, 'quiz', 0)$$, 'collected material can still be self-tested');
select throws_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-04', 1, 'collect')$$, 'P0001', 'TAKEAWAY_NOT_FOUND', 'draft content cannot be collected');

update public.daily_takeaway_progress set learning_date = learning_date - 5 where status = 'collected';
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'currentLesson'->>'id'), 'tennis-03', 'a gap resumes the next lesson without a backlog');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-02', 1, 'collect')$$, 'an old retry does not consume the new day');
select lives_ok($$select public.apply_daily_takeaway_action('00000000-0000-4000-8000-000000008101', 'tennis-03', 1, 'skip')$$, 'the remaining lesson can be skipped');
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'currentLesson'), 'null'::jsonb, 'exhaustion does not recycle old knowledge');
update public.daily_takeaway_lessons set version=2, content=content || '{"version":2,"correctionNote":"测试更正说明"}', reviewed_at=clock_timestamp() where id='tennis-02';
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'history'->0->'lesson'->>'version')::integer, 2, 'history shows the corrected lesson');
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'history'->0->>'collectedVersion')::integer, 1, 'history retains the version originally collected');
update public.daily_takeaway_lessons set published=false where id='tennis-02';
select throws_ok($$update public.daily_takeaway_lessons set content=content || '{"version":3,"correctionNote":"未经审核"}', version=3, reviewed_at=null, reviewed_by=null where id='tennis-02'$$, 'P0001', 'TAKEAWAY_REVIEW_REQUIRED', 'withdrawn content cannot lose its review history or become an unreviewed draft');
select throws_ok($$update public.daily_takeaway_lessons set content=content || '{"version":3,"correctionNote":"未经审核"}', version=3 where id='tennis-02'$$, 'P0001', 'TAKEAWAY_REVIEW_REQUIRED', 'a draft update cannot leak through the historical reader');
select is((public.get_daily_takeaway_state('00000000-0000-4000-8000-000000008101')->'history'->0->'lesson'->>'version')::integer, 2, 'withdrawal preserves the last reviewed history content');
update public.daily_takeaway_lessons set published=true where id='tennis-02';

select function_privs_are('public', 'apply_daily_takeaway_action', array['uuid','text','integer','text','integer'], 'authenticated', array[]::text[], 'clients cannot bypass the verified server context');
select function_privs_are('public', 'get_daily_takeaway_state', array['uuid'], 'anon', array[]::text[], 'anonymous clients cannot read user state');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000008102","role":"authenticated"}', true);
select is((select count(*)::integer from public.daily_takeaway_progress), 0, 'RLS hides another user progress');
select is((select count(*)::integer from public.daily_takeaway_quiz_results), 0, 'RLS hides another user answers');
select is((select count(*)::integer from public.daily_takeaway_lessons), 3, 'RLS hides unpublished lessons');
select throws_ok($$insert into public.daily_takeaway_progress(user_id,lesson_id,status,learning_date,content_version) values ('00000000-0000-4000-8000-000000008102','tennis-01','collected',current_date,1)$$, '42501', null, 'direct writes cannot bypass the daily limit');
reset role;
select * from finish();
rollback;
