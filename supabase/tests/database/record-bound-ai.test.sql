begin;
select no_plan();
select has_column('private', 'ai_generation_jobs', 'record_id', 'AI jobs retain an exact record identity');
select has_column('private', 'ai_generation_jobs', 'base_version', 'AI jobs snapshot the content version');
select has_function('public', 'create_record_ai_generation_job', array['uuid','date','uuid','text','text','text','uuid'], 'record-bound creation exists');

select function_privs_are('public','create_record_ai_generation_job',array['uuid','date','uuid','text','text','text','uuid'],
  'authenticated',array[]::text[],'record binding cannot bypass service authentication');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-4000-8000-000000008801','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bound-ai@internal.invalid','',now(),now(),now()),
 ('00000000-0000-4000-8000-000000008802','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bound-ai-other@internal.invalid','',now(),now(),now());
insert into public.check_ins(id,user_id,checkin_date,entry_mode,attention,source_url,summary,inspiration,user_prompt,learning_status)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000008801','2026-08-01','ai','原有主题','https://example.com/'||n,'原有小结','个人收获','提炼重点','completed'
from generate_series(1,3) n;
create temporary table bound_jobs(slot integer primary key,id uuid,record_id uuid) on commit drop;
insert into bound_jobs
select n,(j.job).id,(j.job).record_id from generate_series(1,3) n
cross join lateral public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'https://example.com/'||n,'example.com','提炼重点',
 ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) j;
select is((select count(*)::integer from bound_jobs),3,'independent same-day records can each have a live job');
select is((select count(*)::integer from public.check_ins where user_id='00000000-0000-4000-8000-000000008801' and active_ai_job_id is not null),3,'all active jobs are discoverable after reopening');
select is((select version from public.check_ins where id='10000000-0000-4000-8000-000000000001'),1,'starting a task does not mutate content version');
select is((select (j.job).id from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 '20000000-0000-4000-8000-000000000001','https://example.com/1','example.com','提炼重点','10000000-0000-4000-8000-000000000001') j),
 (select id from bound_jobs where slot=1),'repeated request reuses the exact task');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000008801'),3,'idempotent retry never reserves twice');
select throws_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 '20000000-0000-4000-8000-000000000004','https://example.com/1','example.com','提炼重点','10000000-0000-4000-8000-000000000001')$$,
 'P0001','AI_RECORD_BUSY','same record cannot enqueue a second live job');
select throws_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008802','2026-08-01',
 '20000000-0000-4000-8000-000000000004','https://example.com/1','example.com','提炼重点','10000000-0000-4000-8000-000000000001')$$,
 'P0001','RECORD_NOT_FOUND','other accounts cannot generate into a record');
select throws_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-02',
 '20000000-0000-4000-8000-000000000004','https://example.com/1','example.com','提炼重点','10000000-0000-4000-8000-000000000001')$$,
 'P0001','AI_RECORD_CONFLICT','date must match the owned record');
select throws_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 '20000000-0000-4000-8000-000000000004','https://example.com/changed','example.com','提炼重点','10000000-0000-4000-8000-000000000001')$$,
 'P0001','AI_RECORD_CONFLICT','source must match the saved record');
select throws_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 '20000000-0000-4000-8000-000000000004','https://example.com/1','example.com','更改要求','10000000-0000-4000-8000-000000000001')$$,
 'P0001','AI_RECORD_CONFLICT','prompt must match the saved record');
select throws_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 '20000000-0000-4000-8000-000000000001','https://example.com/1','example.com','提炼重点','10000000-0000-4000-8000-000000000002')$$,
 'P0001','AI_IDEMPOTENCY_CONFLICT','idempotency cannot redirect a task to another record');

-- Model completion occurs after editing the source and deleting another record.
do $$declare j record; begin
  for j in select id from bound_jobs where slot in (1,2) loop
    perform public.claim_ai_generation_job(j.id);
    perform public.begin_ai_generation(j.id);
  end loop;
end $$;
update public.check_ins set summary='编辑后的小结',source_url='https://example.com/edited',version=2
where id='10000000-0000-4000-8000-000000000001';
delete from public.check_ins where id='10000000-0000-4000-8000-000000000002';
do $$declare j record; begin
  for j in select id from bound_jobs where slot in (1,2) loop
    perform public.complete_ai_generation_job(j.id,true,'AI主题','AI小结','AI建议','资料标题','[]'::jsonb,
      null,null,1,10,0,10,10,0,'test-model',null,decode(repeat('00',32),'hex'));
  end loop;
end $$;
select is((select summary from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'编辑后的小结','late completion never overwrites edited content');
select is((select inspiration from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'个人收获','AI never overwrites personal reflection');
select is((select version from public.check_ins where id='10000000-0000-4000-8000-000000000001'),2,'completion does not increment content version');
select is((select learning_status from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'completed','regeneration preserves previous completion');
select is((select ai_candidate->>'baseVersion' from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'1','candidate retains the stale base version for rejection at confirmation');
select is((select ai_candidate->>'sourceUrl' from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'https://example.com/1','candidate preserves original source');
select is((select ai_candidate->'result'->>'summary' from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'AI小结','candidate is durable without a client callback');
select is((select ai_candidate->'generationContext'->>'userPrompt' from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'提炼重点','candidate retains immutable prompt context');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000008801',true);
select throws_ok($$select * from public.update_learning_record('10000000-0000-4000-8000-000000000001',2,'{"status":"completed"}'::jsonb,(select id from bound_jobs where slot=1),false)$$,
 'P0001','STALE_AI_CANDIDATE','late candidate cannot replace subsequent source/content edits');
select is((select count(*)::integer from public.check_ins where id='10000000-0000-4000-8000-000000000002'),0,'worker cannot resurrect a deleted record');
select ok((select active_ai_job_id is null from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'terminal completion clears active job');
update private.ai_generation_jobs set result_expires_at=now()-interval '1 second',metadata_expires_at=now()-interval '1 second'
where id in (select id from bound_jobs where slot in (1,2));
do $$begin perform public.expire_ai_generation_data(500); end $$;
select is((select ai_candidate->'result'->>'summary' from public.check_ins where id='10000000-0000-4000-8000-000000000001'),'AI小结','candidate survives both result expiration and job deletion');

-- Cancellation retains the old summary and releases the reserved quota once.
do $$begin perform public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000008801',(select id from bound_jobs where slot=3),false); end $$;
select is((select ai_status from public.check_ins where id='10000000-0000-4000-8000-000000000003'),'cancelled','cancellation updates the owning record');
select is((select reserved_count::integer from private.ai_daily_quotas where user_id='00000000-0000-4000-8000-000000008801'),0,'cancelled queued task releases its quota');
insert into bound_jobs select 4,(j.job).id,(j.job).record_id from public.create_ai_generation_job(
 '00000000-0000-4000-8000-000000008801','2026-08-01','20000000-0000-4000-8000-000000000004','https://example.com/legacy','example.com','') j;
select is((select count(*)::integer from public.check_ins where user_id='00000000-0000-4000-8000-000000008801'),3,'legacy client creates independent pending record');
select is((select learning_status from public.check_ins where id=(select record_id from bound_jobs where slot=4)),'pending','legacy capture is not learning completion');
do $$begin
 perform public.claim_ai_generation_job((select id from bound_jobs where slot=4));
 perform public.mark_ai_generation_fetch_failure((select id from bound_jobs where slot=4),'CONTENT_BLOCKED','blocked',false);
end $$;
select is((select ai_status from public.check_ins where id=(select record_id from bound_jobs where slot=4)),'failed','failed jobs persist status without polling');
select is((select ai_error from public.check_ins where id=(select record_id from bound_jobs where slot=4)),'CONTENT_BLOCKED','failed jobs retain safe error code');
update public.check_ins set source_url='https://EXAMPLE.COM#heading'
where id='10000000-0000-4000-8000-000000000003';
select lives_ok($$select * from public.create_record_ai_generation_job('00000000-0000-4000-8000-000000008801','2026-08-01',
 '20000000-0000-4000-8000-000000000005','https://example.com/','example.com','提炼重点','10000000-0000-4000-8000-000000000003')$$,
 'legacy source spellings canonicalize for regeneration without rewriting content');
select * from finish();
rollback;
