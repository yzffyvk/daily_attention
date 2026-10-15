begin;
-- All fixtures, jobs, quota reservations and queue messages are rolled back.
do $$
declare
  test_user uuid := gen_random_uuid();
  test_key uuid := gen_random_uuid();
  old_key uuid := gen_random_uuid();
  test_job uuid;
  returned_version text;
begin
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values(test_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'question-check-' || test_user || '@internal.invalid', '', now(), now(), now());
  insert into public.check_ins(user_id, checkin_date, entry_mode, attention, summary)
  values(test_user, current_date, 'ai', 'Question long-summary check', repeat('知',30000));
  update public.check_ins set summary=repeat('知',30001) where user_id=test_user;
  if not exists(select 1 from public.check_ins where user_id=test_user and length(summary)=30001) then
    raise exception 'long saved summary was changed';
  end if;

  select (created.job).id, (created.job).prompt_version into test_job, returned_version
  from public.create_ai_generation_job(test_user,current_date,test_key,'https://example.com/questions','example.com','') created;
  if returned_version <> 'knowledge-recall-v2' then raise exception 'wrong new prompt version'; end if;
  -- An immutable old job must retain its version when its idempotency key resumes.
  insert into private.ai_generation_jobs(user_id,quota_date,target_date,idempotency_key,source_url,source_host,user_prompt,prompt_version)
  values(test_user,(now() at time zone 'Asia/Shanghai')::date,current_date,old_key,'https://example.com/questions','example.com','','knowledge-relations-v2');
  select (created.job).prompt_version into returned_version
  from public.create_ai_generation_job(test_user,current_date,old_key,'https://example.com/questions','example.com','') created;
  if returned_version <> 'knowledge-relations-v2' then raise exception 'old task version changed'; end if;
  perform public.claim_ai_generation_job(test_job);
  perform public.begin_ai_generation(test_job);
  begin
    perform public.complete_ai_generation_job(test_job,true,'Test',repeat('知',30000),'','Test','[]',null,null,1,10,0,10,10,0,'test',null,decode('ab','hex'));
    raise exception 'invalid digest was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.complete_ai_generation_job(test_job,true,'Test',repeat('知',30000),'','Test','[]',null,null,1,10,0,10,10,0,'test',null,decode(repeat('ab',32),'hex'));
  if not exists(select 1 from private.ai_generation_jobs where id=test_job and status='succeeded' and length(summary)=30000) then
    raise exception 'long completion did not persist intact';
  end if;
  if has_function_privilege('anon', 'public.complete_ai_generation_job(uuid,boolean,text,text,text,text,jsonb,text,text,integer,integer,integer,integer,integer,integer,text,text,bytea)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_ai_generation_job(uuid,boolean,text,text,text,text,jsonb,text,text,integer,integer,integer,integer,integer,integer,text,text,bytea)', 'EXECUTE') then
    raise exception 'completion permissions widened';
  end if;
end $$;
select plan(1);
select pass('question versions, complete long summaries, digest validation and service-only completion verified');
select * from finish();
rollback;
