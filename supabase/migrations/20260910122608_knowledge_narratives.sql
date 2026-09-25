-- Durable, owned learning narratives. Only service-role RPCs mutate generation state.
create table public.knowledge_narratives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  dates date[] not null check (cardinality(dates) between 2 and 14),
  question text not null default '' check (length(question) <= 300),
  title text not null default '正在串联知识' check (length(title) between 1 and 120),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'array'),
  result jsonb,
  status text not null default 'queued' check (status in ('queued','generating','succeeded','failed')),
  error_code text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  claim_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  quota_date date not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (user_id, quota_date) references private.ai_daily_quotas(user_id, quota_date),
  check (status <> 'succeeded' or (result is not null and jsonb_typeof(result) = 'object')),
  check ((status in ('succeeded','failed')) = (finished_at is not null)),
  check (status <> 'generating' or (claim_token is not null and lease_expires_at is not null))
);
create index knowledge_narratives_owner_created on public.knowledge_narratives(user_id, created_at desc, id);
create index knowledge_narratives_pending on public.knowledge_narratives(available_at, created_at) where status = 'queued';
create index knowledge_narratives_leases on public.knowledge_narratives(lease_expires_at) where status = 'generating';
alter table public.knowledge_narratives enable row level security;
revoke all on public.knowledge_narratives from public, anon, authenticated;
grant select on public.knowledge_narratives to authenticated;
grant select, insert, update, delete on public.knowledge_narratives to service_role;
create policy narrative_owner_read on public.knowledge_narratives for select to authenticated using ((select auth.uid()) = user_id);

create function public.create_knowledge_narrative(target_user_id uuid, target_dates date[], target_question text, target_idempotency_key uuid)
returns setof public.knowledge_narratives language plpgsql security definer set search_path = '' as $$
declare
  normalized_dates date[];
  snapshot jsonb;
  existing public.knowledge_narratives%rowtype;
  quota private.ai_daily_quotas%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if target_user_id is null or target_idempotency_key is null or target_question is null or length(btrim(target_question)) > 300
    or target_dates is null or cardinality(target_dates) not between 2 and 14 or array_position(target_dates, null) is not null then
    raise exception 'NARRATIVE_INVALID_INPUT';
  end if;
  select array_agg(d order by d) into normalized_dates from (select distinct unnest(target_dates) d) dates;
  if cardinality(normalized_dates) <> cardinality(target_dates) then raise exception 'NARRATIVE_INVALID_INPUT'; end if;
  -- Serialize requests per account, including idempotency requests spanning midnight.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 6401));
  select * into existing from public.knowledge_narratives where user_id = target_user_id and idempotency_key = target_idempotency_key;
  if found then
    if existing.dates <> normalized_dates or existing.question <> btrim(target_question) then raise exception 'NARRATIVE_IDEMPOTENCY_CONFLICT'; end if;
    return next existing; return;
  end if;
  -- Source content and versions are read together in one statement. Never accept a client-provided snapshot.
  select jsonb_agg(jsonb_build_object('date', checkin_date, 'attention', attention, 'summary', summary,
    'inspiration', inspiration, 'version', version, 'sourceUrl', coalesce(source_url,''), 'hasImage', image_path is not null) order by checkin_date)
    into snapshot from public.check_ins where user_id = target_user_id and checkin_date = any(normalized_dates);
  if snapshot is null or jsonb_array_length(snapshot) <> cardinality(normalized_dates) then raise exception 'NARRATIVE_SOURCES_MISSING'; end if;
  insert into private.ai_daily_quotas(user_id, quota_date) values(target_user_id,today) on conflict do nothing;
  select * into quota from private.ai_daily_quotas where user_id = target_user_id and quota_date = today for update;
  if quota.reserved_count + quota.consumed_count >= 5 then raise exception 'DAILY_AI_LIMIT_REACHED'; end if;
  update private.ai_daily_quotas set reserved_count = reserved_count + 1, updated_at = now() where user_id = target_user_id and quota_date = today;
  return query insert into public.knowledge_narratives(user_id,idempotency_key,dates,question,source_snapshot,quota_date)
    values(target_user_id,target_idempotency_key,normalized_dates,btrim(target_question),snapshot,today) returning *;
end;
$$;

create function public.claim_knowledge_narrative()
returns setof public.knowledge_narratives language plpgsql security definer set search_path = '' as $$
declare job public.knowledge_narratives%rowtype;
begin
  -- A killed worker's final attempt is eventually terminal, never an eternal spinner.
  update public.knowledge_narratives set status = 'failed', error_code = 'NARRATIVE_RETRY_EXHAUSTED',
    finished_at = now(), updated_at = now(), claim_token = null, lease_expires_at = null
    where status = 'generating' and lease_expires_at < now() and attempt_count >= 3;
  select * into job from public.knowledge_narratives
    where (status = 'queued' and available_at <= now()) or (status = 'generating' and lease_expires_at < now() and attempt_count < 3)
    order by created_at for update skip locked limit 1;
  if not found then return; end if;
  if job.started_at is null then
    update private.ai_daily_quotas set reserved_count = reserved_count - 1, consumed_count = consumed_count + 1, updated_at = now()
      where user_id = job.user_id and quota_date = job.quota_date;
  end if;
  return query update public.knowledge_narratives set status = 'generating', attempt_count = attempt_count + 1,
    claim_token = gen_random_uuid(), lease_expires_at = now() + interval '180 seconds', started_at = coalesce(started_at,now()),
    error_code = null, updated_at = now() where id = job.id returning *;
end;
$$;

create function public.finish_knowledge_narrative(target_id uuid, target_claim_token uuid, target_result jsonb, target_error_code text, target_retryable boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.knowledge_narratives%rowtype;
begin
  select * into job from public.knowledge_narratives where id = target_id and status = 'generating'
    and claim_token = target_claim_token and lease_expires_at > now() for update;
  if not found then return false; end if;
  if target_result is not null then
    if jsonb_typeof(target_result) <> 'object' or length(coalesce(target_result->>'title','')) not between 1 and 120 then
      raise exception 'NARRATIVE_RESULT_INVALID';
    end if;
    update public.knowledge_narratives set status = 'succeeded', title = target_result->>'title', result = target_result,
      error_code = null, finished_at = now(), updated_at = now(), claim_token = null, lease_expires_at = null where id = job.id;
  else
    if target_error_code is null or length(target_error_code) not between 1 and 80 or target_retryable is null then raise exception 'NARRATIVE_RESULT_INVALID'; end if;
    update public.knowledge_narratives set status = case when target_retryable and attempt_count < 3 then 'queued' else 'failed' end,
      error_code = target_error_code, available_at = now() + interval '5 seconds' * attempt_count,
      finished_at = case when target_retryable and attempt_count < 3 then null else now() end,
      updated_at = now(), claim_token = null, lease_expires_at = null where id = job.id;
  end if;
  return true;
end;
$$;

revoke all on function public.create_knowledge_narrative(uuid,date[],text,uuid) from public, anon, authenticated;
revoke all on function public.claim_knowledge_narrative() from public, anon, authenticated;
revoke all on function public.finish_knowledge_narrative(uuid,uuid,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.create_knowledge_narrative(uuid,date[],text,uuid) to service_role;
grant execute on function public.claim_knowledge_narrative() to service_role;
grant execute on function public.finish_knowledge_narrative(uuid,uuid,jsonb,text,boolean) to service_role;
