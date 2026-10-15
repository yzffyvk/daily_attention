begin;
select plan(10);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000009501','create-replay@test.invalid');
insert into public.profiles(id,email,display_name,avatar_key) values ('00000000-0000-4000-8000-000000009501','create-replay@test.invalid','重试测试',1);
insert into public.albums(id,user_id,name) values ('00000000-0000-4000-8000-000000009502','00000000-0000-4000-8000-000000009501','New album');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009501","role":"authenticated"}',true);

select lives_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://example.test/"}'::jsonb)$$,'initial capture succeeds even if its HTTP response is lost');
select throws_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://example.test/","status":"completed"}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','retrying a capture as completed must not falsely report the pending row as saved');
select throws_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://example.test/","albumId":"00000000-0000-4000-8000-000000009502"}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','retrying into a different album must require explicit conflict recovery');
select results_eq($$select learning_status,album_id,version from public.check_ins where id='00000000-0000-4000-8000-000000009503'$$,$$values ('pending'::text,null::uuid,1)$$,'conflicting capture retries leave the saved record unchanged');

select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009503',1,'{"summary":"Edited in another tab"}'::jsonb,null,false)$$,'another tab edits the captured record at version one');
select throws_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://example.test/"}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','a stale create retry conflicts even when the cloud record is already version two');
select results_eq($$select summary,version from public.check_ins where id='00000000-0000-4000-8000-000000009503'$$,$$values ('Edited in another tab'::text,2)$$,'rejected stale create preserves the other tab content and version');
select lives_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://example.test/","summary":"Edited in another tab"}'::jsonb)$$,'a fully identical retry may return the current record at any version');
select throws_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://example.test/","summary":"Edited in another tab","aiGenerationContext":{"userPrompt":"new context","promptVersion":"v1"}}'::jsonb)$$,'P0001','IDEMPOTENCY_CONFLICT','generated-content context is included in complete payload equality');
select lives_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009503','{"date":"2026-07-01","attention":"Captured","sourceUrl":"https://EXAMPLE.test:443#heading","summary":"Edited in another tab","inspiration":"","imagePath":null,"imageName":"","albumId":null,"status":"pending","entryMode":"manual","userPrompt":"","aiGenerationContext":null}'::jsonb)$$,'canonical source and explicit defaults are equivalent to the inserted payload');
select * from finish();
rollback;
