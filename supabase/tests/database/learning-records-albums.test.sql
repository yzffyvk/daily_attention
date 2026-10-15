begin;
select plan(31);
insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000009101','records-one@test.invalid'), ('00000000-0000-4000-8000-000000009102','records-two@test.invalid');
insert into public.profiles(id,email,display_name,avatar_key) values
('00000000-0000-4000-8000-000000009101','records-one@test.invalid','学习一',1),
('00000000-0000-4000-8000-000000009102','records-two@test.invalid','学习二',2);
insert into public.albums(id,user_id,name) values
('00000000-0000-4000-8000-000000009201','00000000-0000-4000-8000-000000009101','My album'),
('00000000-0000-4000-8000-000000009202','00000000-0000-4000-8000-000000009102','Foreign album');
insert into public.check_ins(id,user_id,checkin_date,attention,learning_status) values
('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009101','2026-07-01','One','completed'),
('00000000-0000-4000-8000-000000009302','00000000-0000-4000-8000-000000009101','2026-07-01','Two','pending'),
('00000000-0000-4000-8000-000000009303','00000000-0000-4000-8000-000000009101','2026-07-02','Three','pending'),
('00000000-0000-4000-8000-000000009304','00000000-0000-4000-8000-000000009102','2026-07-01','Foreign','completed');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',true);
select is((select count(*) from public.check_ins where checkin_date='2026-07-01'),2::bigint,'same day and mode supports independent records');
select is((select count(*) from public.albums),1::bigint,'albums protected by owner RLS');
select results_eq($$select * from public.get_check_in_stats('2026-07-02')$$,$$values (1::bigint,1,false)$$,'pending captures do not count as learning');
select throws_ok($$select public.move_learning_records(array['00000000-0000-4000-8000-000000009301'::uuid],'00000000-0000-4000-8000-000000009202')$$,'P0001','ALBUM_NOT_FOUND','cannot move into foreign album');
select throws_ok($$select public.move_learning_records(array['00000000-0000-4000-8000-000000009301'::uuid,'00000000-0000-4000-8000-000000009304'::uuid],'00000000-0000-4000-8000-000000009201')$$,'P0001','RECORD_NOT_FOUND','batch move rejects foreign IDs atomically');
select is((select album_id from public.check_ins where id='00000000-0000-4000-8000-000000009301'),null::uuid,'failed batch move leaves owned record untouched');
select is(public.move_learning_records(array['00000000-0000-4000-8000-000000009301'::uuid,'00000000-0000-4000-8000-000000009302'::uuid],'00000000-0000-4000-8000-000000009201'),2,'move applies to every requested record');
select is((select version from public.check_ins where id='00000000-0000-4000-8000-000000009301'),1,'album move preserves content version');
select throws_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',2,'{"summary":"lost"}'::jsonb,null,false)$$,'P0001','VERSION_CONFLICT','stale content update rejected');
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009302',1,'{"status":"completed"}'::jsonb,null,false)$$,'manual completion is allowed');
select results_eq($$select * from public.get_check_in_stats('2026-07-02')$$,$$values (1::bigint,1,false)$$,'multiple completed records still count one learning day');
select lives_ok($$delete from public.albums where id='00000000-0000-4000-8000-000000009201'$$,'delete own album');
select is((select count(*) from public.check_ins where album_id is null),3::bigint,'album deletion unfiles and preserves all records');
select throws_ok($$select * from public.delete_learning_record('00000000-0000-4000-8000-000000009301',99)$$,'P0001','VERSION_CONFLICT','stale deletion is rejected');
select throws_ok($$select * from public.delete_learning_record('00000000-0000-4000-8000-000000009304',1)$$,'P0001','RECORD_NOT_FOUND','foreign record deletion rejected');
select throws_ok($$update public.check_ins set checkin_date='2026-07-03' where id='00000000-0000-4000-8000-000000009301'$$,'P0001','IMMUTABLE_RECORD_IDENTITY','record date cannot change');
select throws_ok($$update public.check_ins set album_id='00000000-0000-4000-8000-000000009202' where id='00000000-0000-4000-8000-000000009301'$$,'23503',null,'foreign album blocked even via direct data API');

reset role;
update public.check_ins set source_url='https://example.com/',summary='Accepted content',inspiration='My reflection',user_prompt='',ai_candidate=jsonb_build_object(
  'jobId','00000000-0000-4000-8000-000000009401','sourceUrl','https://example.com/','userPrompt','','baseVersion',1,'generationContext',null,
  'result',jsonb_build_object('attention','AI title','summary','Candidate content','inspiration','AI reflection','sourceTitle','Example','warnings','[]'::jsonb),'createdAt',now())
where id='00000000-0000-4000-8000-000000009301';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009101","role":"authenticated"}',true);
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',1,'{"albumId":null}'::jsonb,null,false)$$,'album-only patch may coexist with candidate');
select is((select version from public.check_ins where id='00000000-0000-4000-8000-000000009301'),1,'album-only patch preserves candidate base version');
select throws_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',1,'{"sourceUrl":"https://different.test/"}'::jsonb,null,false)$$,'P0001','SOURCE_CHANGE_REQUIRES_NEW_RECORD','existing accepted content cannot be reassigned a different link');
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',1,'{"inspiration":"Edited reflection"}'::jsonb,null,false)$$,'editing a record while candidate waits is safe');
select throws_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',2,'{"status":"completed"}'::jsonb,'00000000-0000-4000-8000-000000009401',false)$$,'P0001','STALE_AI_CANDIDATE','stale candidate cannot overwrite later edits');
reset role;
update public.check_ins set ai_candidate=jsonb_set(ai_candidate,'{baseVersion}','2'::jsonb) where id='00000000-0000-4000-8000-000000009301';
set local role authenticated;
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',2,'{"status":"completed"}'::jsonb,'00000000-0000-4000-8000-000000009401',false)$$,'explicit confirmation accepts current candidate');
select results_eq($$select summary,inspiration,version,ai_candidate from public.check_ins where id='00000000-0000-4000-8000-000000009301'$$,$$values ('Candidate content'::text,'Edited reflection'::text,3,null::jsonb)$$,'confirmation replaces candidate summary and preserves personal reflection');
select lives_ok($$select * from public.update_learning_record('00000000-0000-4000-8000-000000009301',2,'{"status":"completed"}'::jsonb,'00000000-0000-4000-8000-000000009401',false)$$,'lost confirmation response can be retried idempotently');
select is((select version from public.check_ins where id='00000000-0000-4000-8000-000000009301'),3,'confirmation replay does not increment version twice');
select lives_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009306','{"date":"2026-07-01","attention":"Collected","sourceUrl":"https://example.test/","status":"pending"}'::jsonb)$$,'stable ID creates another record on an existing day');
select lives_ok($$select * from public.create_learning_record('00000000-0000-4000-8000-000000009306','{"date":"2026-07-01","attention":"Collected","sourceUrl":"https://example.test/","status":"pending"}'::jsonb)$$,'exact create replay returns existing record');
select is((select count(*) from public.check_ins where id='00000000-0000-4000-8000-000000009306'),1::bigint,'create replay has a single persistent record');

select is(public.normalize_learning_source_url('https://EXAMPLE.com:443#heading'),'https://example.com/','legacy links normalize root slash host and fragment without rewriting content');
select is(public.normalize_learning_source_url('https://example.com/path?q=1#heading'),'https://example.com/path?q=1','normalization preserves meaningful query and path');
select * from finish();
rollback;
