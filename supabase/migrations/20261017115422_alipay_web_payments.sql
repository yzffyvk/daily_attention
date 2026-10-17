create table public.payment_orders (
  out_trade_no text primary key,
  owner_hash text not null,
  app_id text not null,
  total_amount text not null check (total_amount ~ '^[0-9]+\.[0-9]{2}$' and total_amount::numeric > 0),
  state text not null default 'PENDING_PAYMENT' check (state in ('PENDING_PAYMENT','PAID','CLOSED','UNKNOWN')),
  trade_no text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(owner_hash, idempotency_key)
);
create index payment_orders_owner_idx on public.payment_orders(owner_hash);
create table public.payment_events (
  event_id text primary key,
  out_trade_no text not null references public.payment_orders(out_trade_no),
  trade_no text not null,
  event_type text not null,
  created_at timestamptz not null default now()
);
create index payment_events_order_idx on public.payment_events(out_trade_no);
create table public.payment_refunds (
  out_request_no text primary key,
  out_trade_no text not null references public.payment_orders(out_trade_no),
  amount text not null check (amount ~ '^[0-9]+\.[0-9]{2}$' and amount::numeric > 0),
  reason text not null,
  state text not null default 'PENDING' check (state in ('PENDING','REFUNDED')),
  created_at timestamptz not null default now()
);
create index payment_refunds_order_idx on public.payment_refunds(out_trade_no);
alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_refunds enable row level security;
revoke all on public.payment_orders, public.payment_events, public.payment_refunds from anon, authenticated;
grant select, insert, update on public.payment_orders, public.payment_events, public.payment_refunds to service_role;

create function public.payment_create_order(p_order text, p_owner text, p_app text, p_amount text, p_key text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.payment_orders;
begin
  insert into public.payment_orders(out_trade_no, owner_hash, app_id, total_amount, idempotency_key)
  values(p_order, p_owner, p_app, p_amount, p_key) on conflict(owner_hash, idempotency_key) do nothing;
  select * into strict v_order from public.payment_orders where owner_hash=p_owner and idempotency_key=p_key;
  if v_order.app_id <> p_app or v_order.total_amount <> p_amount then raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(v_order);
end;
$$;

create function public.payment_apply_event(p_order text, p_trade text, p_state text, p_event text, p_type text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_order public.payment_orders;
begin
  select * into strict v_order from public.payment_orders where out_trade_no=p_order for update;
  if coalesce(v_order.trade_no,'') <> '' and coalesce(p_trade,'') <> '' and v_order.trade_no <> p_trade then raise exception 'PAYMENT_TRADE_MISMATCH'; end if;
  insert into public.payment_events(event_id,out_trade_no,trade_no,event_type) values(p_event,p_order,coalesce(p_trade,''),p_type) on conflict do nothing;
  if not found then return; end if;
  update public.payment_orders set
    state = case when p_state='PAID' then 'PAID' when state='PAID' then 'PAID' when p_state='CLOSED' then 'CLOSED' when state='CLOSED' then 'CLOSED' else state end,
    trade_no = coalesce(nullif(p_trade,''),trade_no)
  where out_trade_no=p_order;
end;
$$;

create function public.payment_reserve_refund(p_order text,p_request text,p_amount text,p_reason text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_order public.payment_orders; v_refund public.payment_refunds; v_total numeric;
begin
  select * into strict v_order from public.payment_orders where out_trade_no=p_order for update;
  select * into v_refund from public.payment_refunds where out_request_no=p_request;
  if found then
    if v_refund.out_trade_no <> p_order or v_refund.amount <> p_amount or v_refund.reason <> p_reason then raise exception 'PAYMENT_REFUND_CONFLICT'; end if;
    return to_jsonb(v_refund);
  end if;
  if v_order.state <> 'PAID' then raise exception 'PAYMENT_NOT_PAID'; end if;
  select coalesce(sum(amount::numeric),0) into v_total from public.payment_refunds where out_trade_no=p_order;
  if p_amount !~ '^[0-9]+\.[0-9]{2}$' or p_amount::numeric <= 0 or v_total+p_amount::numeric > v_order.total_amount::numeric then raise exception 'PAYMENT_REFUND_EXCEEDS_PAID'; end if;
  insert into public.payment_refunds(out_request_no,out_trade_no,amount,reason) values(p_request,p_order,p_amount,p_reason) returning * into v_refund;
  return to_jsonb(v_refund);
end;
$$;
revoke all on function public.payment_create_order(text,text,text,text,text), public.payment_apply_event(text,text,text,text,text), public.payment_reserve_refund(text,text,text,text) from public, anon, authenticated;
grant execute on function public.payment_create_order(text,text,text,text,text), public.payment_apply_event(text,text,text,text,text), public.payment_reserve_refund(text,text,text,text) to service_role;
