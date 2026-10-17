begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-4000-8000-000000009701','00000000-0000-0000-0000-000000000000','authenticated','authenticated','credits@internal.invalid','',now(),now(),now()),
('00000000-0000-4000-8000-000000009702','00000000-0000-0000-0000-000000000000','authenticated','authenticated','refund-credits@internal.invalid','',now(),now(),now());

create function pg_temp.credit_job(k uuid default gen_random_uuid()) returns uuid language plpgsql as $$
declare job_id uuid;
begin
 select (j.job).id into job_id from public.create_ai_generation_job('00000000-0000-4000-8000-000000009701',
 (now() at time zone 'Asia/Shanghai')::date,k,'https://example.com/credits','example.com','') j;
 return job_id;
end; $$;
create temporary table credit_cases(name text primary key,id uuid);
insert into credit_cases values('free1',pg_temp.credit_job()),('free2',pg_temp.credit_job());
select throws_ok($$select pg_temp.credit_job()$$,'P0001','DAILY_AI_LIMIT_REACHED','only two free shared tasks are available');
select public.payment_create_credit_order('credit-order','owner','00000000-0000-4000-8000-000000009701','app','ai_1','sandbox','key');
select is((select total_amount from public.payment_orders where out_trade_no='credit-order'),'0.90','the database sets the SKU price');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','0','an unpaid order gives no credits');
select public.payment_apply_event('credit-order','trade','PAID','credit-event','payment');
select public.payment_apply_event('credit-order','trade','PAID','credit-event','payment');
select public.payment_apply_event('credit-order','trade','PAID','another-query','query');
select is((select count(*)::integer from private.ai_credit_lots where order_no='credit-order'),1,'notify and query grant a purchase once');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','1','payment grants its snapshotted count');
select ok((select expires_at=created_at+interval '90 days' from private.ai_credit_lots where order_no='credit-order'),'validity starts at confirmed payment');
insert into credit_cases values('paid',pg_temp.credit_job('00000000-0000-4000-8000-000000009711'));
select is((select funding_source from private.ai_credit_allocations where job_id=(select id from credit_cases where name='paid')),'paid','the third task uses paid credits');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','0','a queued task reserves its paid credit');
select is(pg_temp.credit_job('00000000-0000-4000-8000-000000009711'),(select id from credit_cases where name='paid'),'job replay reuses its existing reservation');
select throws_ok($$select pg_temp.credit_job()$$,'P0001','DAILY_AI_LIMIT_REACHED','reserved credits cannot be spent twice');
select public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000009701',(select id from credit_cases where name='paid'),false);
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','1','queued cancellation returns the paid credit');
select public.cancel_ai_generation_job_v2('00000000-0000-4000-8000-000000009701',(select id from credit_cases where name='paid'),false);
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','1','cancellation replay cannot double refund');

insert into credit_cases values('failed-paid',pg_temp.credit_job());
select public.claim_ai_generation_job((select id from credit_cases where name='failed-paid'));
select public.begin_ai_generation((select id from credit_cases where name='failed-paid'));
select is((select consumed_count from private.ai_credit_lots where order_no='credit-order'),1,'starting generation consumes its reserved credit');
select throws_ok($$select public.payment_reserve_refund('credit-order','busy-refund','0.90','unused')$$,'P0001','PAYMENT_CREDIT_REFUND_REQUIRES_UNUSED_PACK','generation reservations and consumption block refund');
select public.mark_ai_generation_provider_failure((select id from credit_cases where name='failed-paid'),'MODEL_SERVICE_ERROR','重试',true,1,10,0,10,5,0);
select public.claim_ai_generation_job((select id from credit_cases where name='failed-paid'));
select public.begin_ai_generation((select id from credit_cases where name='failed-paid'));
select is((select consumed_count from private.ai_credit_lots where order_no='credit-order'),1,'automatic retries reuse the same paid allocation');
select public.complete_ai_generation_job((select id from credit_cases where name='failed-paid'),false,null,null,null,null,'[]',
 'MODEL_SERVICE_ERROR','服务失败',1,100,0,100,50,0,'test-model',null,null);
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','1','terminal provider failures refund the original paid credit');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'freeRemaining','0','paid failure never creates a free credit');

update private.ai_credit_lots set expires_at=now()-interval '1 second' where order_no='credit-order';
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','0','expired credits are excluded');
select throws_ok($$select pg_temp.credit_job()$$,'P0001','DAILY_AI_LIMIT_REACHED','expired credits cannot create a task');

-- A task reserved before expiry can run; failure restores its original lot only.
update private.ai_credit_lots set expires_at=now()+interval '1 day' where order_no='credit-order';
insert into credit_cases values('rollover-paid',pg_temp.credit_job());
select public.claim_ai_generation_job((select id from credit_cases where name='rollover-paid'));
select public.begin_ai_generation((select id from credit_cases where name='rollover-paid'));
insert into private.ai_daily_quotas(user_id,quota_date,consumed_count)
values('00000000-0000-4000-8000-000000009701',(now() at time zone 'Asia/Shanghai')::date-1,1);
update private.ai_generation_jobs set quota_date=(now() at time zone 'Asia/Shanghai')::date-1 where id=(select id from credit_cases where name='rollover-paid');
update private.ai_daily_quotas set consumed_count=0 where user_id='00000000-0000-4000-8000-000000009701' and quota_date=(now() at time zone 'Asia/Shanghai')::date;
update private.ai_credit_lots set expires_at=now()-interval '1 second' where order_no='credit-order';
select public.complete_ai_generation_job((select id from credit_cases where name='rollover-paid'),false,null,null,null,null,'[]',
 'MODEL_OUTPUT_INVALID','质量失败',1,100,0,100,50,0,'test-model',null,null);
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'freeRemaining','0','cross-day paid failure cannot replenish current free quota');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','0','returning a credit cannot extend an expired lot');
select is((select available_count from private.ai_credit_lots where order_no='credit-order'),1,'the expired original lot retains its returned credit for audit');

-- The narrative entrypoint spends the same paid pool after the two free slots.
select public.payment_create_credit_order('narrative-credit-order','owner','00000000-0000-4000-8000-000000009701','app','ai_1','sandbox','narrative-credit-key');
select public.payment_apply_event('narrative-credit-order','narrative-trade','PAID','narrative-paid','payment');
insert into public.check_ins(id,user_id,checkin_date,entry_mode,attention,summary,learning_status)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000009701',
 (now() at time zone 'Asia/Shanghai')::date,'manual','资料','完整内容','completed' from generate_series(1,2) n;
insert into credit_cases select 'narrative',id from public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000009701',
 array['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002']::uuid[],'',gen_random_uuid());
select is((select funding_source from private.ai_credit_allocations where job_kind='narrative' and job_id=(select id from credit_cases where name='narrative')),'paid','knowledge narrative reserves from the shared paid pool');
update private.ai_daily_quotas set reserved_count=reserved_count-1,consumed_count=consumed_count+1 where user_id='00000000-0000-4000-8000-000000009701' and quota_date=(now() at time zone 'Asia/Shanghai')::date;
grant select on credit_cases to service_role;
set local role service_role;
select lives_ok($$update public.knowledge_narratives set status='generating',started_at=now(),attempt_count=1,
 claim_token=gen_random_uuid(),lease_expires_at=now()+interval '180 seconds' where id=(select id from credit_cases where name='narrative')$$,
 'the service-role worker can settle a narrative without direct access to private billing tables');
reset role;
select public.finish_knowledge_narrative(id,claim_token,null,'NARRATIVE_RETRY_EXHAUSTED',false)
 from public.knowledge_narratives where id=(select id from credit_cases where name='narrative');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','1','narrative terminal failure refunds the same paid lot');
insert into credit_cases select 'deleted-narrative',id from public.create_record_knowledge_narrative('00000000-0000-4000-8000-000000009701',
 array['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002']::uuid[],'',gen_random_uuid());
select public.delete_knowledge_narrative('00000000-0000-4000-8000-000000009701',(select id from credit_cases where name='deleted-narrative'));
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'paidRemaining','1','deleting a queued narrative releases its original paid reservation');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009701')->>'freeRemaining','0','deleting a paid narrative cannot mint a free slot');

select public.payment_create_credit_order('refund-credit-order','owner2','00000000-0000-4000-8000-000000009702','app','ai_20','sandbox','refund-key');
select public.payment_apply_event('refund-credit-order','trade2','PAID','refund-credit-event','payment');
select throws_ok($$select public.payment_reserve_refund('refund-credit-order','partial','1.00','partial')$$,'P0001','PAYMENT_CREDIT_REFUND_REQUIRES_UNUSED_PACK','credit refunds require a complete unused pack');
select public.payment_reserve_refund('refund-credit-order','whole','16.90','unused');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009702')->>'paidRemaining','0','pending refunds freeze credits before contacting the gateway');
select public.payment_confirm_refund('whole');
select public.payment_confirm_refund('whole');
select is((select refunded_count from private.ai_credit_lots where order_no='refund-credit-order'),20,'confirmed refund revokes credits exactly once');
select public.payment_apply_event('refund-credit-order','trade2','PAID','late-payment','payment');
select is(public.read_ai_credit_balance('00000000-0000-4000-8000-000000009702')->>'paidRemaining','0','late payment replay cannot restore refunded credits');
select throws_ok($$select public.payment_create_credit_order('other','owner','00000000-0000-4000-8000-000000009701','app','ai_10','sandbox','key')$$,'P0001','PAYMENT_IDEMPOTENCY_CONFLICT','an idempotency key cannot switch products');
select ok(not has_table_privilege('authenticated','private.ai_credit_lots','select,insert,update,delete'),'clients cannot alter credit lots');
select ok(not has_function_privilege('authenticated','public.read_ai_credit_balance(uuid)','execute'),'balance RPC is server only');
select ok(not has_function_privilege('anon','public.payment_create_credit_order(text,text,uuid,text,text,text,text)','execute'),'anonymous clients cannot create credit orders');
do $$begin for n in 1..21 loop
 perform public.payment_create_credit_order('AI'||replace(gen_random_uuid()::text,'-',''),'owner2',
  '00000000-0000-4000-8000-000000009702','app','ai_1','sandbox','history-key-'||n);
end loop; end $$;
create temporary table history_page as select item,ordinality from jsonb_array_elements(
 public.payment_list_credit_orders('00000000-0000-4000-8000-000000009702',null,null)) with ordinality items(item,ordinality);
select is((select count(*)::integer from history_page),21,'order pagination returns a 20-item page plus one lookahead');
create temporary table history_next as select item from jsonb_array_elements(public.payment_list_credit_orders(
 '00000000-0000-4000-8000-000000009702',(select (item->>'created_at')::timestamptz from history_page where ordinality=20),
 (select item->>'out_trade_no' from history_page where ordinality=20))) items(item);
select is((select count(*)::integer from history_next),2,'older orders remain reachable even when timestamps are identical');
select is((select count(*)::integer from history_next n join history_page p on p.item->>'out_trade_no'=n.item->>'out_trade_no' where p.ordinality<=20),0,'keyset pages have no duplicate order');
select * from finish();
rollback;
