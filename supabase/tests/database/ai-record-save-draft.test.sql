begin;
select plan(8);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000008801','ai-save-draft@test.invalid');
insert into public.profiles(id,email,display_name,avatar_key) values ('00000000-0000-4000-8000-000000008801','ai-save-draft@test.invalid','草稿测试',1);
insert into public.check_ins(id,user_id,checkin_date,attention,source_url,summary,inspiration,learning_status,ai_candidate)
values ('00000000-0000-4000-8000-000000008802','00000000-0000-4000-8000-000000008801','2026-07-01','Original','https://example.com/','','My understanding','pending',jsonb_build_object(
 'jobId','00000000-0000-4000-8000-000000008803','baseVersion',1,'sourceUrl','https://example.com/','userPrompt','','generationContext',null,
 'result',jsonb_build_object('attention','AI title','summary','AI summary','inspiration','AI suggestion')));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000008801","role":"authenticated"}',true);
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000008802',1,'{"status":"pending","summary":"Edited AI summary"}'::jsonb,'00000000-0000-4000-8000-000000008803',false)$$,'save draft adopts generated content without marking completed');
select results_eq($$select attention::text,summary,inspiration,learning_status,version,ai_candidate from public.check_ins where id='00000000-0000-4000-8000-000000008802'$$,$$values ('AI title'::text,'Edited AI summary'::text,'My understanding'::text,'pending'::text,2,null::jsonb)$$,'draft saves edits, clears the result and preserves personal understanding');
select results_eq($$select * from public.get_check_in_stats('2026-07-01')$$,$$values (0::bigint,0,false)$$,'saved AI drafts do not count as completed learning');
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000008802',1,'{"status":"pending","summary":"Edited AI summary"}'::jsonb,'00000000-0000-4000-8000-000000008803',false)$$,'lost draft save response can be retried idempotently');
select is((select version from public.check_ins where id='00000000-0000-4000-8000-000000008802'),2,'draft save replay does not increment version');
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000008802',2,'{"status":"completed"}'::jsonb,null,false)$$,'confirm finishes a saved AI draft through the ordinary save path');
select is((select learning_status from public.check_ins where id='00000000-0000-4000-8000-000000008802'),'completed','confirm marks the saved AI record completed');
select results_eq($$select * from public.get_check_in_stats('2026-07-01')$$,$$values (1::bigint,1,true)$$,'confirmation counts the learning day');
select * from finish();
rollback;
