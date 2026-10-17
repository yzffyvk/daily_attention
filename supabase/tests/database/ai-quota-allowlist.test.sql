begin;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000009501','00000000-0000-0000-0000-000000000000','authenticated','authenticated','quota-allowlisted@internal.invalid','',now(),now(),now()),
 ('00000000-0000-4000-8000-000000009502','00000000-0000-0000-0000-000000000000','authenticated','authenticated','quota-ordinary@internal.invalid','',now(),now(),now());
insert into private.ai_quota_allowlist(user_id,reason) values('00000000-0000-4000-8000-000000009501','regression test');

select table_privs_are('private','ai_quota_allowlist','authenticated',array[]::text[],'users cannot grant themselves unlimited quota');
select table_privs_are('private','ai_quota_allowlist','anon',array[]::text[],'anonymous callers cannot inspect the allowlist');
select table_privs_are('private','ai_quota_allowlist','service_role',array[]::text[],'the application cannot edit the allowlist');
select function_privs_are('private','has_unlimited_ai_quota',array['uuid'],'authenticated',array[]::text[],'allowlist lookup stays private');

create temporary table allowlist_jobs(slot integer, id uuid, response jsonb) on commit drop;
insert into allowlist_jobs select n,(j.job).id,to_jsonb(j) from generate_series(1,7) n
cross join lateral public.create_ai_generation_job('00000000-0000-4000-8000-000000009501','2026-08-01',
 ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'https://example.com/'||n,'example.com','') j;
select is((select count(*)::integer from allowlist_jobs),7,'allowlisted account can submit more than five jobs');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009501'),7,'unlimited access still records real usage');
select ok((select bool_and(response->>'quota_unlimited'='true' and response->'quota_remaining'='null'::jsonb) from allowlist_jobs),'creation explicitly reports unlimited quota');
select lives_ok($$select * from public.create_ai_generation_job('00000000-0000-4000-8000-000000009501','2026-08-01',
 '20000000-0000-4000-8000-000000000007','https://example.com/7','example.com','')$$,'idempotent retry succeeds above five');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009501'),7,'retry never reserves twice');

-- Existing worker entrypoints must keep settling usage above five.
do $$declare j record; begin
 for j in select id from allowlist_jobs where slot<=3 order by slot loop
   perform public.claim_ai_generation_job(j.id);
   perform public.begin_ai_generation(j.id);
   perform public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000009501',j.id,false);
 end loop;
end $$;
select is((select count(*)::integer from private.ai_generation_jobs where user_id='00000000-0000-4000-8000-000000009501' and status='cancelled'),3,'unlimited model cancellations need no quota confirmation');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009501'),4,'cancellation settles each started job exactly once');
select is((select consumed_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000009501'),0,'unlimited cancellation refunds accounting');
select is(public.read_ai_generation_job_state('00000000-0000-4000-8000-000000009501',(select id from allowlist_jobs where slot=4))#>>'{quota,unlimited}','true','polling reports the same whitelist state');

-- Normal users, including users claiming unlimited access via editable metadata, still stop at five.
update auth.users set raw_user_meta_data='{"unlimited":true,"ai_quota_allowlisted":true}'::jsonb where id='00000000-0000-4000-8000-000000009502';
do $$begin for n in 1..5 loop
 perform public.create_ai_generation_job('00000000-0000-4000-8000-000000009502','2026-08-01',gen_random_uuid(),'https://example.com/'||n,'example.com','');
end loop; end $$;
select throws_ok($$select * from public.create_ai_generation_job('00000000-0000-4000-8000-000000009502','2026-08-01',gen_random_uuid(),'https://example.com/6','example.com','')$$,
 'P0001','DAILY_AI_LIMIT_REACHED','ordinary account still stops at five');

-- Both consumers of the shared quota use the same account entitlement.
insert into public.check_ins(id,user_id,checkin_date,entry_mode,attention,summary,inspiration,learning_status)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000009501','2026-08-01','manual','source','summary','reflection','completed' from generate_series(1,2) n;
select lives_ok($test$do $body$ begin for n in 1..3 loop
 perform public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000009501',array['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002']::uuid[],'',gen_random_uuid());
end loop; end $body$;$test$,'knowledge narratives also honor the shared unlimited quota');

delete from private.ai_quota_allowlist where user_id='00000000-0000-4000-8000-000000009501';
select throws_ok($$select * from public.create_ai_generation_job('00000000-0000-4000-8000-000000009501','2026-08-01',gen_random_uuid(),'https://example.com/revoked','example.com','')$$,
 'P0001','DAILY_AI_LIMIT_REACHED','removing allowlist entry restores the daily limit immediately');
select is(public.read_ai_generation_job_state('00000000-0000-4000-8000-000000009501',(select id from allowlist_jobs where slot=4))#>>'{quota,remaining}','0','revoked account reports zero instead of negative remaining quota');
select lives_ok($$select public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000009501',(select id from allowlist_jobs where slot=4),false)$$,'existing queued jobs can still settle after removal');
select * from finish();
rollback;
