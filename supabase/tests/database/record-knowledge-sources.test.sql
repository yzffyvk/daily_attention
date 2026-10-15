begin;
select no_plan();
select has_function('public','create_record_knowledge_narrative',array['uuid','uuid[]','text','uuid'],'record-specific narrative creation exists');
select function_privs_are('public','create_record_knowledge_narrative',array['uuid','uuid[]','text','uuid'],'authenticated',array[]::text[],'clients cannot supply another user ID');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000007801','00000000-0000-0000-0000-000000000000','authenticated','authenticated','record-narrative-one@internal.invalid','',now(),now(),now()),
 ('00000000-0000-4000-8000-000000007802','00000000-0000-0000-0000-000000000000','authenticated','authenticated','record-narrative-two@internal.invalid','',now(),now(),now());
insert into public.check_ins(id,user_id,checkin_date,entry_mode,attention,summary,learning_status) values
 ('00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007801','2026-09-01','manual','访谈','访谈依据','completed'),
 ('00000000-0000-4000-8000-000000007812','00000000-0000-4000-8000-000000007801','2026-09-01','ai','验证','验证依据','completed'),
 ('00000000-0000-4000-8000-000000007813','00000000-0000-4000-8000-000000007801','2026-09-01','manual','未整理','','pending');
create temporary table record_narrative_job as select * from public.create_record_knowledge_narrative(
 '00000000-0000-4000-8000-000000007801',array['00000000-0000-4000-8000-000000007812','00000000-0000-4000-8000-000000007811']::uuid[],'','00000000-0000-4000-8000-000000007821');
select is((select jsonb_array_length(source_snapshot) from record_narrative_job),2,'same date mixed-mode sources both retained');
select is((select cardinality(dates) from record_narrative_job),1,'display dates are deduplicated');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000007801'),1,'one shared quota reserved');
select is((select id from public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000007801',array['00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007812']::uuid[],'','00000000-0000-4000-8000-000000007821')),(select id from record_narrative_job),'reordered retry is idempotent');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000007801'),1,'retry does not reserve twice');
select throws_ok($$select public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000007801',array['00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007813']::uuid[],'','00000000-0000-4000-8000-000000007822')$$,'P0001','NARRATIVE_SOURCES_MISSING','pending records cannot be used');
select throws_ok($$select public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000007802',array['00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007812']::uuid[],'','00000000-0000-4000-8000-000000007823')$$,'P0001','NARRATIVE_SOURCES_MISSING','foreign sources cannot be used');
select throws_ok($$select public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000007801',array['00000000-0000-4000-8000-000000007811','00000000-0000-4000-8000-000000007811']::uuid[],'','00000000-0000-4000-8000-000000007824')$$,'P0001','NARRATIVE_INVALID_INPUT','duplicate source IDs rejected');
delete from public.check_ins where id='00000000-0000-4000-8000-000000007811';
select is((select jsonb_array_length(source_snapshot) from public.knowledge_narratives where id=(select id from record_narrative_job)),2,'deleting original record preserves saved snapshots');
select * from finish();
rollback;
