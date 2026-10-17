begin;

alter table public.payment_orders
  add column user_id uuid references auth.users(id) on delete set null,
  add column product_id text,
  add column product_title text,
  add column credit_count integer check (credit_count > 0),
  add column valid_days integer check (valid_days > 0),
  add column environment text check (environment in ('sandbox','production')),
  add constraint payment_credit_snapshot check (
    (user_id is null and product_id is null and credit_count is null and valid_days is null and environment is null)
    or (product_id is not null and product_title is not null
      and credit_count is not null and valid_days is not null and environment is not null));
create index payment_orders_user_idx on public.payment_orders(user_id,created_at desc) where user_id is not null;

create table private.ai_credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_no text not null unique references public.payment_orders(out_trade_no),
  total_count integer not null check (total_count > 0),
  available_count integer not null check (available_count >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  consumed_count integer not null default 0 check (consumed_count >= 0),
  refunded_count integer not null default 0 check (refunded_count >= 0),
  frozen boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (available_count + reserved_count + consumed_count + refunded_count = total_count)
);
create index ai_credit_lots_spend_idx on private.ai_credit_lots(user_id,expires_at,created_at,id)
  where available_count > 0 and not frozen;
create table private.ai_credit_allocations (
  job_kind text not null check (job_kind in ('extraction','narrative')),
  job_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  funding_source text not null check (funding_source in ('free','paid','unlimited')),
  lot_id uuid references private.ai_credit_lots(id) on delete cascade,
  state text not null check (state in ('reserved','consumed','released')),
  created_at timestamptz not null default now(),
  primary key(job_kind,job_id),
  check ((funding_source='paid') = (lot_id is not null))
);
create index ai_credit_allocations_day_idx on private.ai_credit_allocations(user_id,quota_date)
  where funding_source='paid' and state <> 'released';
create index ai_credit_allocations_lot_idx on private.ai_credit_allocations(lot_id) where lot_id is not null;
alter table private.ai_credit_lots enable row level security;
alter table private.ai_credit_allocations enable row level security;
revoke all on private.ai_credit_lots,private.ai_credit_allocations from public,anon,authenticated,service_role;

create function public.payment_create_credit_order(
 p_order text,p_owner text,p_user uuid,p_app text,p_product text,p_mode text,p_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.payment_orders; v_amount text; v_count integer; v_title text;
begin
 if p_user is null or p_owner is null or p_app is null or p_key is null
   or length(p_key) not between 1 and 100 or p_mode is null or p_mode not in ('sandbox','production') then
   raise exception 'PAYMENT_ORDER_INVALID';
 end if;
 case p_product
  when 'ai_1' then v_amount:='0.90'; v_count:=1; v_title:='单次提炼';
  when 'ai_10' then v_amount:='8.90'; v_count:=10; v_title:='10 次提炼包';
  when 'ai_20' then v_amount:='16.90'; v_count:=20; v_title:='20 次提炼包';
  else raise exception 'PAYMENT_PRODUCT_INVALID';
 end case;
 insert into public.payment_orders(out_trade_no,owner_hash,user_id,app_id,total_amount,idempotency_key,
  product_id,product_title,credit_count,valid_days,environment)
 values(p_order,p_owner,p_user,p_app,v_amount,p_key,p_product,v_title,v_count,90,p_mode)
 on conflict(owner_hash,idempotency_key) do nothing;
 select * into strict v_order from public.payment_orders where owner_hash=p_owner and idempotency_key=p_key;
 if v_order.user_id is distinct from p_user or v_order.app_id<>p_app
   or v_order.product_id is distinct from p_product or v_order.environment is distinct from p_mode then
   raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT';
 end if;
 return to_jsonb(v_order);
end; $$;

create or replace function public.payment_apply_event(p_order text,p_trade text,p_state text,p_event text,p_type text)
returns void language plpgsql security definer set search_path='' as $$
declare v_order public.payment_orders; event_order text;
begin
 select * into strict v_order from public.payment_orders where out_trade_no=p_order for update;
 if coalesce(v_order.trade_no,'')<>'' and coalesce(p_trade,'')<>'' and v_order.trade_no<>p_trade then
  raise exception 'PAYMENT_TRADE_MISMATCH'; end if;
 if p_state='PAID' and (coalesce(p_trade,'')='' or p_type not in ('payment','query')) then
  raise exception 'PAYMENT_EVENT_INVALID'; end if;
 insert into public.payment_events(event_id,out_trade_no,trade_no,event_type)
 values(p_event,p_order,coalesce(p_trade,''),p_type) on conflict do nothing;
 if not found then
  select out_trade_no into event_order from public.payment_events where event_id=p_event;
  if event_order<>p_order then raise exception 'PAYMENT_EVENT_CONFLICT'; end if;
  return;
 end if;
 update public.payment_orders set
  state=case when p_state='PAID' then 'PAID' when state='PAID' then 'PAID'
    when p_state='CLOSED' then 'CLOSED' when state='CLOSED' then 'CLOSED' else state end,
  trade_no=coalesce(nullif(p_trade,''),trade_no) where out_trade_no=p_order;
 if p_state='PAID' and v_order.user_id is not null then
  insert into private.ai_credit_lots(user_id,order_no,total_count,available_count,expires_at)
  values(v_order.user_id,p_order,v_order.credit_count,v_order.credit_count,now()+make_interval(days=>v_order.valid_days))
  on conflict(order_no) do nothing;
 end if;
end; $$;

create function private.ai_paid_allocated(target_user_id uuid,target_day date)
returns integer language sql stable set search_path='' as $$
 select count(*)::integer from private.ai_credit_allocations
 where user_id=target_user_id and quota_date=target_day and funding_source='paid' and state<>'released';
$$;
create function private.ai_paid_remaining(target_user_id uuid)
returns integer language sql stable set search_path='' as $$
 select coalesce(sum(available_count),0)::integer from private.ai_credit_lots
 where user_id=target_user_id and expires_at>now() and not frozen;
$$;
create or replace function private.ai_quota_remaining(target_user_id uuid,used_count integer)
returns integer language sql stable set search_path='' as $$
 select case when private.has_unlimited_ai_quota(target_user_id) then null else
  greatest(0,2-used_count+private.ai_paid_allocated(target_user_id,(now() at time zone 'Asia/Shanghai')::date))
   +private.ai_paid_remaining(target_user_id) end;
$$;

create function public.read_ai_credit_balance(target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Shanghai')::date; used integer; free_left integer; paid_left integer; unlimited boolean; batches jsonb;
begin
 if target_user_id is null then raise exception 'BILLING_USER_REQUIRED'; end if;
 select reserved_count+consumed_count into used from private.ai_daily_quotas where user_id=target_user_id and quota_date=today;
 unlimited:=private.has_unlimited_ai_quota(target_user_id);
 free_left:=greatest(0,2-coalesce(used,0)+private.ai_paid_allocated(target_user_id,today));
 paid_left:=private.ai_paid_remaining(target_user_id);
 select coalesce(jsonb_agg(jsonb_build_object('orderNo',order_no,'remaining',available_count,'expiresAt',expires_at)
  order by expires_at,created_at,id),'[]'::jsonb) into batches from private.ai_credit_lots
  where user_id=target_user_id and expires_at>now() and available_count>0 and not frozen;
 return jsonb_build_object('freeLimit',2,'freeRemaining',free_left,'paidRemaining',paid_left,
  'remaining',case when unlimited then null else free_left+paid_left end,'unlimited',unlimited,
  'resetsAt',(today+1)::timestamp at time zone 'Asia/Shanghai','lots',batches);
end; $$;

create function private.reserve_ai_credit()
returns trigger language plpgsql security definer set search_path='' as $$
declare kind text:=case when tg_table_name='ai_generation_jobs' then 'extraction' else 'narrative' end;
 used integer; paid_used integer; lot private.ai_credit_lots; funding text;
begin
 -- Copying an existing result is a read operation and has no generation charge.
 if new.status <> 'queued' then return new; end if;
 -- Creation RPCs already hold this user's quota-day row through the insertion.
 select reserved_count+consumed_count into strict used from private.ai_daily_quotas
 where user_id=new.user_id and quota_date=new.quota_date for update;
 paid_used:=private.ai_paid_allocated(new.user_id,new.quota_date);
 if private.has_unlimited_ai_quota(new.user_id) then funding:='unlimited';
 elsif used-1-paid_used<2 then funding:='free';
 else
  -- All spenders lock lots in the same order. Never skip a locked earlier lot:
  -- a concurrent refund may be freezing it and must win or lose atomically.
  select * into lot from private.ai_credit_lots where user_id=new.user_id and available_count>0
    and expires_at>now() and not frozen order by expires_at,created_at,id limit 1 for update;
  if not found then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_credit_lots set available_count=available_count-1,reserved_count=reserved_count+1 where id=lot.id;
  funding:='paid';
 end if;
 insert into private.ai_credit_allocations(job_kind,job_id,user_id,quota_date,funding_source,lot_id,state)
 values(kind,new.id,new.user_id,new.quota_date,funding,lot.id,'reserved');
 return new;
end; $$;

-- One terminal settlement for every system failure, including quality failures.
drop trigger ai_generation_jobs_refund_quality_failure on private.ai_generation_jobs;
create function private.settle_ai_credit()
returns trigger language plpgsql security definer set search_path='' as $$
declare kind text:=case when tg_table_name='ai_generation_jobs' then 'extraction' else 'narrative' end;
 allocation private.ai_credit_allocations; release_credit boolean:=false; terminal_failure boolean;
begin
 if new.quota_date is distinct from old.quota_date then
  update private.ai_credit_allocations set quota_date=new.quota_date where job_kind=kind and job_id=new.id;
 end if;
 if old.status in ('succeeded','failed','cancelled') then return new; end if;
 terminal_failure:=new.status='failed';
 if terminal_failure then
  if old.started_at is not null then
   update private.ai_daily_quotas set consumed_count=consumed_count-1
    where user_id=new.user_id and quota_date=new.quota_date;
  end if;
  release_credit:=true;
 elsif kind='extraction' and new.status='cancelled' then
  release_credit:=coalesce((to_jsonb(new)->>'cancelled_without_quota')::boolean,true);
 end if;
 select * into allocation from private.ai_credit_allocations where job_kind=kind and job_id=new.id for update;
 if not found or allocation.state='released' then return new; end if;
 if release_credit then
  if allocation.funding_source='paid' then
   update private.ai_credit_lots set available_count=available_count+1,
    reserved_count=reserved_count-case when allocation.state='reserved' then 1 else 0 end,
    consumed_count=consumed_count-case when allocation.state='consumed' then 1 else 0 end
    where id=allocation.lot_id;
  end if;
  update private.ai_credit_allocations set state='released' where job_kind=kind and job_id=new.id;
 elsif allocation.state='reserved' and new.started_at is not null then
  if allocation.funding_source='paid' then
   update private.ai_credit_lots set reserved_count=reserved_count-1,consumed_count=consumed_count+1 where id=allocation.lot_id;
  end if;
  update private.ai_credit_allocations set state='consumed' where job_kind=kind and job_id=new.id;
 end if;
 return new;
end; $$;

-- Preserve the old user-facing quality failure explanation, without a second refund.
create function private.explain_ai_failure_refund()
returns trigger language plpgsql security invoker set search_path='' as $$
begin new.error_message:='本次提炼未成功，未消耗使用次数，请重试。'; return new; end; $$;
create trigger ai_jobs_explain_refund before update of status on private.ai_generation_jobs
 for each row when (old.status not in ('succeeded','failed','cancelled') and new.status='failed')
 execute function private.explain_ai_failure_refund();
create trigger ai_jobs_reserve_credit after insert on private.ai_generation_jobs for each row execute function private.reserve_ai_credit();
create trigger ai_generation_jobs_credit_settle after update of status,started_at,quota_date on private.ai_generation_jobs for each row execute function private.settle_ai_credit();
create trigger narrative_reserve_credit after insert on public.knowledge_narratives for each row execute function private.reserve_ai_credit();
create trigger narrative_settle_credit after update of status,started_at,quota_date on public.knowledge_narratives for each row execute function private.settle_ai_credit();

create or replace function public.payment_reserve_refund(p_order text,p_request text,p_amount text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.payment_orders; v_refund public.payment_refunds; v_total numeric; lot private.ai_credit_lots;
begin
 select * into strict v_order from public.payment_orders where out_trade_no=p_order for update;
 select * into v_refund from public.payment_refunds where out_request_no=p_request;
 if found then
  if v_refund.out_trade_no<>p_order or v_refund.amount<>p_amount or v_refund.reason<>p_reason then raise exception 'PAYMENT_REFUND_CONFLICT'; end if;
  return to_jsonb(v_refund);
 end if;
 if v_order.state<>'PAID' then raise exception 'PAYMENT_NOT_PAID'; end if;
 select coalesce(sum(amount::numeric),0) into v_total from public.payment_refunds where out_trade_no=p_order;
 if p_amount !~ '^[0-9]+\.[0-9]{2}$' or p_amount::numeric<=0 or v_total+p_amount::numeric>v_order.total_amount::numeric then
  raise exception 'PAYMENT_REFUND_EXCEEDS_PAID'; end if;
 if v_order.credit_count is not null then
  select * into strict lot from private.ai_credit_lots where order_no=p_order for update;
  if p_amount::numeric<>v_order.total_amount::numeric or lot.available_count<>lot.total_count
    or lot.reserved_count<>0 or lot.consumed_count<>0 or lot.refunded_count<>0 or lot.frozen then
   raise exception 'PAYMENT_CREDIT_REFUND_REQUIRES_UNUSED_PACK'; end if;
  update private.ai_credit_lots set frozen=true where id=lot.id;
 end if;
 insert into public.payment_refunds(out_request_no,out_trade_no,amount,reason)
 values(p_request,p_order,p_amount,p_reason) returning * into v_refund;
 return to_jsonb(v_refund);
end; $$;
create function public.payment_confirm_refund(p_request text)
returns void language plpgsql security definer set search_path='' as $$
declare refund public.payment_refunds;
begin
 -- Order -> refund -> lot is the same lock order as reservation.
 perform 1 from public.payment_orders o join public.payment_refunds r on r.out_trade_no=o.out_trade_no
  where r.out_request_no=p_request for update of o;
 select * into strict refund from public.payment_refunds where out_request_no=p_request for update;
 if refund.state='REFUNDED' then return; end if;
 update private.ai_credit_lots set refunded_count=refunded_count+available_count,available_count=0,frozen=true
  where order_no=refund.out_trade_no;
 update public.payment_refunds set state='REFUNDED' where out_request_no=p_request;
end; $$;

revoke all on function public.payment_create_credit_order(text,text,uuid,text,text,text,text),
 public.payment_apply_event(text,text,text,text,text),public.payment_reserve_refund(text,text,text,text),
 public.payment_confirm_refund(text),public.read_ai_credit_balance(uuid) from public,anon,authenticated;
grant execute on function public.payment_create_credit_order(text,text,uuid,text,text,text,text),
 public.payment_apply_event(text,text,text,text,text),public.payment_reserve_refund(text,text,text,text),
 public.payment_confirm_refund(text),public.read_ai_credit_balance(uuid) to service_role;
revoke all on function private.ai_paid_allocated(uuid,date),private.ai_paid_remaining(uuid),
 private.reserve_ai_credit(),private.settle_ai_credit(),private.explain_ai_failure_refund() from public,anon,authenticated,service_role;

create or replace function private.release_deleted_narrative_credit()
returns trigger language plpgsql security definer set search_path='' as $$
declare allocation private.ai_credit_allocations;
begin
 if old.status<>'queued' or old.started_at is not null then return old; end if;
 select * into allocation from private.ai_credit_allocations
  where job_kind='narrative' and job_id=old.id for update;
 if not found or allocation.state='released' then return old; end if;
 if allocation.funding_source='paid' then
  update private.ai_credit_lots set available_count=available_count+1,reserved_count=reserved_count-1 where id=allocation.lot_id;
 end if;
 update private.ai_credit_allocations set state='released' where job_kind='narrative' and job_id=old.id;
 return old;
end; $$;
revoke all on function private.release_deleted_narrative_credit() from public,anon,authenticated,service_role;
create trigger narrative_delete_credit after delete on public.knowledge_narratives
 for each row execute function private.release_deleted_narrative_credit();

-- Updated creation RPCs and quota state follow below; historical migrations stay immutable.
create or replace function public.create_record_ai_generation_job(
  target_user_id uuid, target_date date, target_idempotency_key uuid,
  target_source_url text, target_source_host text, target_user_prompt text,
  target_record_id uuid
)
returns setof public.ai_generation_job_with_quota
language plpgsql security definer set search_path = '' as $$
declare
  normalized_prompt text := pg_catalog.btrim(coalesce(target_user_prompt, ''));
  quota_day date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
  quota private.ai_daily_quotas%rowtype;
  job private.ai_generation_jobs%rowtype;
  current_record public.check_ins%rowtype;
begin
  if target_user_id is null or target_date is null or target_idempotency_key is null
    or target_source_url is null or target_source_host is null
    or target_source_url = '' or target_source_host = ''
    or pg_catalog.length(target_source_url) > 2048 or pg_catalog.length(target_source_host) > 253
    or pg_catalog.char_length(normalized_prompt) > 1000 then
    raise exception using errcode = '22023', message = 'invalid AI generation job';
  end if;
  if target_date > quota_day then
    raise exception using errcode = 'P0001', message = 'FUTURE_DATE_NOT_ALLOWED';
  end if;

  -- Per-user quota lock serializes idempotency before any record mutation.
  insert into private.ai_daily_quotas(user_id, quota_date)
  values(target_user_id, quota_day) on conflict do nothing;
  select * into quota from private.ai_daily_quotas q
  where q.user_id = target_user_id and q.quota_date = quota_day for update;
  select * into job from private.ai_generation_jobs j
  where j.user_id = target_user_id and j.idempotency_key = target_idempotency_key;
  if found then
    if job.target_date is distinct from target_date or job.source_url is distinct from target_source_url
      or job.user_prompt is distinct from normalized_prompt
      or (target_record_id is not null and job.record_id is distinct from target_record_id) then
      raise exception using errcode = 'P0001', message = 'AI_IDEMPOTENCY_CONFLICT';
    end if;
    select * into quota from private.ai_daily_quotas q
    where q.user_id = job.user_id and q.quota_date = job.quota_date;
    return query select private.to_ai_generation_job_record(job),
      (quota.reserved_count + quota.consumed_count)::integer, quota.reserved_count::integer,
      quota.consumed_count::integer, private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count),
      private.has_unlimited_ai_quota(target_user_id);
    return;
  end if;

  if target_record_id is null then
    -- Compatibility callers create a new independent pending item, never upsert a day.
    insert into public.check_ins(user_id, checkin_date, entry_mode, attention, source_url,
      user_prompt, learning_status, completed_at)
    values(target_user_id, target_date, 'ai', pg_catalog.left(target_source_host, 120), target_source_url,
      normalized_prompt, 'pending', null) returning * into current_record;
  else
    select * into current_record from public.check_ins c
    where c.id = target_record_id and c.user_id = target_user_id for update;
    if not found then raise exception using errcode = 'P0001', message = 'RECORD_NOT_FOUND'; end if;
    if current_record.checkin_date is distinct from target_date
      or public.normalize_learning_source_url(current_record.source_url) is distinct from target_source_url
      or pg_catalog.btrim(current_record.user_prompt) is distinct from normalized_prompt then
      raise exception using errcode = 'P0001', message = 'AI_RECORD_CONFLICT';
    end if;
    if exists(select 1 from private.ai_generation_jobs j where j.record_id = current_record.id
      and j.status in ('queued','fetching','generating','retryable')) then
      raise exception using errcode = 'P0001', message = 'AI_RECORD_BUSY';
    end if;
  end if;
  if private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count) <= 0 and not private.has_unlimited_ai_quota(target_user_id) then
    raise exception using errcode = 'P0001', message = 'DAILY_AI_LIMIT_REACHED';
  end if;
  update private.ai_daily_quotas q set reserved_count = q.reserved_count + 1
  where q.user_id = target_user_id and q.quota_date = quota_day returning * into quota;
  insert into private.ai_generation_jobs(user_id, quota_date, target_date, idempotency_key,
    source_url, source_host, user_prompt, record_id, base_version)
  values(target_user_id, quota_day, target_date, target_idempotency_key, target_source_url,
    pg_catalog.lower(target_source_host), normalized_prompt, current_record.id, current_record.version) returning * into job;
  perform pgmq.send('ai_generation_jobs', pg_catalog.jsonb_build_object('job_id', job.id));
  return query select private.to_ai_generation_job_record(job),
    (quota.reserved_count + quota.consumed_count)::integer, quota.reserved_count::integer,
    quota.consumed_count::integer, private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count),
      private.has_unlimited_ai_quota(target_user_id);
end;
$$;

create or replace function public.create_knowledge_narrative(target_user_id uuid, target_dates date[], target_question text, target_idempotency_key uuid, target_entry_mode text default 'manual')
returns setof public.knowledge_narratives language plpgsql security definer set search_path = '' as $$
declare
  normalized_dates date[];
  snapshot jsonb;
  existing public.knowledge_narratives%rowtype;
  quota private.ai_daily_quotas%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if target_entry_mode is null or target_entry_mode not in ('manual','ai')
    or target_user_id is null or target_idempotency_key is null or target_question is null or length(btrim(target_question)) > 300
    or target_dates is null or cardinality(target_dates) not between 2 and 14 or array_position(target_dates, null) is not null then
    raise exception 'NARRATIVE_INVALID_INPUT';
  end if;
  select array_agg(d order by d) into normalized_dates from (select distinct unnest(target_dates) d) dates;
  if cardinality(normalized_dates) <> cardinality(target_dates) then raise exception 'NARRATIVE_INVALID_INPUT'; end if;
  -- Serialize requests per account, including idempotency requests spanning midnight.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 6401));
  select * into existing from public.knowledge_narratives where user_id = target_user_id and idempotency_key = target_idempotency_key;
  if found then
    if existing.dates <> normalized_dates or existing.question <> btrim(target_question)
      or coalesce(existing.source_snapshot->0->>'entryMode', 'manual') <> target_entry_mode then raise exception 'NARRATIVE_IDEMPOTENCY_CONFLICT'; end if;
    return next existing; return;
  end if;
  -- Source content and versions are read together in one statement. Never accept a client-provided snapshot.
  select jsonb_agg(jsonb_build_object('id', id, 'entryMode', entry_mode, 'date', checkin_date, 'attention', attention, 'summary', summary,
    'inspiration', inspiration, 'version', version, 'sourceUrl', coalesce(source_url,''), 'hasImage', image_path is not null) order by checkin_date)
    into snapshot from public.check_ins where user_id = target_user_id and entry_mode = target_entry_mode and checkin_date = any(normalized_dates);
  if snapshot is null or jsonb_array_length(snapshot) <> cardinality(normalized_dates) then raise exception 'NARRATIVE_SOURCES_MISSING'; end if;
  insert into private.ai_daily_quotas(user_id, quota_date) values(target_user_id,today) on conflict do nothing;
  select * into quota from private.ai_daily_quotas where user_id = target_user_id and quota_date = today for update;
  if private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count) <= 0 and not private.has_unlimited_ai_quota(target_user_id) then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count = reserved_count + 1, updated_at = now() where user_id = target_user_id and quota_date = today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,normalized_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;

create or replace function public.create_record_knowledge_narrative(target_user_id uuid, target_record_ids uuid[], target_question text, target_idempotency_key uuid)
returns setof public.knowledge_narratives language plpgsql security definer set search_path = '' as $$
declare
  normalized_ids uuid[];
  existing_ids uuid[];
  source_dates date[];
  snapshot jsonb;
  existing public.knowledge_narratives%rowtype;
  quota private.ai_daily_quotas%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if target_user_id is null or target_idempotency_key is null or target_question is null or length(btrim(target_question)) > 300
    or target_record_ids is null or cardinality(target_record_ids) not between 2 and 14 or array_position(target_record_ids,null) is not null then
    raise exception 'NARRATIVE_INVALID_INPUT';
  end if;
  select array_agg(id order by id) into normalized_ids from (select distinct unnest(target_record_ids) id) records;
  if cardinality(normalized_ids) <> cardinality(target_record_ids) then raise exception 'NARRATIVE_INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text,6401));
  select * into existing from public.knowledge_narratives where user_id=target_user_id and idempotency_key=target_idempotency_key;
  if found then
    select array_agg((item->>'id')::uuid order by (item->>'id')::uuid) into existing_ids from jsonb_array_elements(existing.source_snapshot) item;
    if existing_ids is distinct from normalized_ids or existing.question <> btrim(target_question) then raise exception 'NARRATIVE_IDEMPOTENCY_CONFLICT'; end if;
    return next existing; return;
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'entryMode',entry_mode,'date',checkin_date,'attention',attention,'summary',summary,
    'inspiration',inspiration,'version',version,'sourceUrl',coalesce(source_url,''),'hasImage',image_path is not null) order by checkin_date,created_at,id),
    array_agg(distinct checkin_date order by checkin_date)
    into snapshot,source_dates from public.check_ins
    where user_id=target_user_id and id=any(normalized_ids) and learning_status='completed' and checkin_date<=today;
  if snapshot is null or jsonb_array_length(snapshot)<>cardinality(normalized_ids) then raise exception 'NARRATIVE_SOURCES_MISSING'; end if;
  insert into private.ai_daily_quotas(user_id,quota_date) values(target_user_id,today) on conflict do nothing;
  select * into quota from private.ai_daily_quotas where user_id=target_user_id and quota_date=today for update;
  if private.ai_quota_remaining(target_user_id, quota.reserved_count + quota.consumed_count) <= 0 and not private.has_unlimited_ai_quota(target_user_id) then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count=reserved_count+1,updated_at=now() where user_id=target_user_id and quota_date=today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,source_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;

create or replace function private.ai_generation_job_state(current_job private.ai_generation_jobs)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (pg_catalog.now() at time zone 'Asia/Shanghai')::date;
  reserved integer := 0;
  consumed integer := 0;
  free_used integer := 0;
  unlimited boolean := private.has_unlimited_ai_quota(current_job.user_id);
begin
  select q.reserved_count, q.consumed_count into reserved, consumed
  from private.ai_daily_quotas q where q.user_id = current_job.user_id and q.quota_date = today;
  reserved := coalesce(reserved, 0);
  consumed := coalesce(consumed, 0);
  select a.used_count into free_used from private.ai_cancel_daily_allowances a
  where a.user_id = current_job.user_id and a.cancellation_date = today;
  free_used := coalesce(free_used, 0);
  return pg_catalog.jsonb_build_object(
    'job', pg_catalog.to_jsonb(private.to_ai_generation_job_record(current_job)),
    'quota', pg_catalog.jsonb_build_object('used', reserved + consumed, 'reserved', reserved,
      'consumed', consumed, 'limit', case when unlimited then null else 2 end,
      'remaining', private.ai_quota_remaining(current_job.user_id, reserved + consumed), 'unlimited', unlimited),
    'cancellation', pg_catalog.jsonb_build_object('freeRemaining', 2 - free_used,
      'requiresConfirmation', current_job.status in ('queued', 'fetching', 'generating', 'retryable')
        and current_job.started_at is not null and free_used >= 2 and not unlimited,
      'charged', case when current_job.status = 'cancelled'
        then not coalesce(current_job.cancelled_without_quota, true) else null end)
  );
end;
$$;

create or replace function public.payment_list_credit_orders(target_user_id uuid,target_before_time timestamptz default null,target_before_order text default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.out_trade_no desc),'[]'::jsonb) from (
  select o.*,r.state as refund_state,l.expires_at,
   coalesce(l.available_count,0) as credits_remaining,
   coalesce(o.state='PAID' and not l.frozen and l.available_count=l.total_count
    and l.reserved_count=0 and l.consumed_count=0 and l.refunded_count=0,false) as refundable
  from public.payment_orders o
  left join private.ai_credit_lots l on l.order_no=o.out_trade_no
  left join lateral (select state from public.payment_refunds where out_trade_no=o.out_trade_no order by created_at desc limit 1) r on true
  where o.user_id=target_user_id and (target_before_time is null or (o.created_at,o.out_trade_no)<(target_before_time,target_before_order))
  order by o.created_at desc,o.out_trade_no desc limit 21
 ) rows;
$$;
revoke all on function public.payment_list_credit_orders(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.payment_list_credit_orders(uuid,timestamptz,text) to service_role;

notify pgrst, 'reload schema';
commit;
