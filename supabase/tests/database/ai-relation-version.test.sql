begin;
select plan(3);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000978', '00000000-0000-0000-0000-000000000000',
'authenticated','authenticated','ai-relations@internal.invalid','',now(),now(),now());
create temporary table relation_job as select (created.job).* from public.create_ai_generation_job(
'00000000-0000-4000-8000-000000000978', (now() at time zone 'Asia/Shanghai')::date,
'10000000-0000-4000-8000-000000000978','https://example.com/relations','example.com','') created;
select is((select prompt_version::text from relation_job),'knowledge-questions-v1','normal task creation selects question-aware prompt');
select is((select user_prompt from relation_job),'','default generation needs no user requirements');
select is((select prompt_version::text from public.read_ai_generation_job('00000000-0000-4000-8000-000000000978',(select id from relation_job))),'knowledge-questions-v1','persisted task snapshot retains question-aware version');
select * from finish();
rollback;
