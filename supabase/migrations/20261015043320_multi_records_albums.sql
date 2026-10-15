-- Daily learning is a collection of independent records; existing IDs/content survive.
create table public.albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index albums_user_created_idx on public.albums(user_id,created_at desc,id desc);
alter table public.albums enable row level security;
revoke all on public.albums from public, anon;
grant select,insert,update,delete on public.albums to authenticated;
grant all on public.albums to service_role;
create policy albums_select_own on public.albums for select to authenticated using (user_id=(select auth.uid()));
create policy albums_insert_own on public.albums for insert to authenticated with check (user_id=(select auth.uid()));
create policy albums_update_own on public.albums for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy albums_delete_own on public.albums for delete to authenticated using (user_id=(select auth.uid()));
create trigger albums_touch_updated_at before update on public.albums for each row execute function private.touch_updated_at();

-- Canonical comparison key for historical links without rewriting their saved source.
-- New HTTP inputs already use WHATWG URL normalization; this covers legacy host case,
-- default ports, omitted root slash and ordinary section fragments while preserving queries.
create function public.normalize_learning_source_url(value text)
returns text language plpgsql immutable strict security invoker set search_path='' as $$
declare result text:=btrim(value); authority text; rest text; fragment text;
begin
  fragment:=substring(result from '#.*$');
  if fragment is not null and fragment !~* '^#([!/?]|%(2f|21|3f))' then result:=split_part(result,'#',1); end if;
  authority:=substring(result from '^https?://[^/?#]+');
  if authority is null then return result; end if;
  rest:=substring(result from length(authority)+1);
  authority:=lower(authority);
  if authority like 'https://%' then authority:=regexp_replace(authority,':443$','');
  else authority:=regexp_replace(authority,':80$',''); end if;
  if rest='' or left(rest,1) in ('?','#') then rest:='/'||rest; end if;
  return authority||rest;
end; $$;
revoke all on function public.normalize_learning_source_url(text) from public,anon,authenticated;
grant execute on function public.normalize_learning_source_url(text) to authenticated,service_role;

alter table public.check_ins drop constraint check_ins_user_date_mode_key;
alter table public.check_ins
  add column source_url_key text generated always as (public.normalize_learning_source_url(source_url)) stored,
  add column album_id uuid,
  add column learning_status text not null default 'completed' check (learning_status in ('pending','completed')),
  add column completed_at timestamptz,
  add column ai_candidate jsonb,
  add column accepted_ai_job_id uuid,
  add column active_ai_job_id uuid,
  add column ai_status text,
  add column ai_error text,
  add constraint check_ins_album_owner_fk foreign key (album_id,user_id) references public.albums(id,user_id) on delete set null (album_id);
-- Historical completion metadata must not alter edit timestamps or reject preserved
-- future-dated legacy rows. Only this migration's backfill bypasses these guards.
alter table public.check_ins disable trigger check_ins_date_guard;
alter table public.check_ins disable trigger check_ins_touch_updated_at;
update public.check_ins set completed_at=created_at;
alter table public.check_ins enable trigger check_ins_touch_updated_at;
alter table public.check_ins enable trigger check_ins_date_guard;
create index check_ins_user_created_idx on public.check_ins(user_id,created_at desc,id desc);
create index check_ins_album_created_idx on public.check_ins(user_id,album_id,created_at desc,id desc);
create index check_ins_pending_idx on public.check_ins(user_id,created_at desc,id desc) where learning_status='pending';
create index check_ins_user_source_idx on public.check_ins(user_id,source_url_key);

create function private.guard_learning_record_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.checkin_date is distinct from old.checkin_date) then
    raise exception 'IMMUTABLE_RECORD_IDENTITY';
  end if;
  if new.learning_status='pending' then new.completed_at := null;
  elsif tg_op='INSERT' or old.learning_status='pending' then new.completed_at := clock_timestamp();
  else new.completed_at := coalesce(old.completed_at,old.created_at); end if;
  return new;
end; $$;
revoke all on function private.guard_learning_record_identity() from public,anon,authenticated;
create trigger check_ins_learning_guard before insert or update on public.check_ins for each row execute function private.guard_learning_record_identity();

-- A stable client-generated ID makes replayed creates harmless. No date-based upsert.
create function public.create_learning_record(target_id uuid, payload jsonb)
returns setof public.check_ins language plpgsql security invoker set search_path='' as $$
declare r public.check_ins%rowtype; owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'SESSION_EXPIRED'; end if;
  if target_id is null or payload is null then raise exception 'INVALID_RECORD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_id::text,9211));
  select * into r from public.check_ins where id=target_id and user_id=owner_id;
  if found then
    if r.checkin_date::text <> payload->>'date' or (r.version=1 and (
      r.attention is distinct from payload->>'attention' or coalesce(r.source_url,'') is distinct from coalesce(payload->>'sourceUrl','')
      or r.summary is distinct from coalesce(payload->>'summary','') or r.inspiration is distinct from coalesce(payload->>'inspiration','')
      or r.entry_mode is distinct from coalesce(payload->>'entryMode','manual')
      or r.user_prompt is distinct from coalesce(payload->>'userPrompt','')
      or r.image_path is distinct from payload->>'imagePath' or r.image_name is distinct from coalesce(payload->>'imageName','')
    )) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return next r; return;
  end if;
  if payload->>'albumId' is not null and not exists(select 1 from public.albums where id=(payload->>'albumId')::uuid and user_id=owner_id) then raise exception 'ALBUM_NOT_FOUND'; end if;
  return query insert into public.check_ins(id,user_id,checkin_date,entry_mode,attention,source_url,user_prompt,ai_generation_context,summary,inspiration,image_path,image_name,album_id,learning_status)
    values(target_id,owner_id,(payload->>'date')::date,coalesce(payload->>'entryMode','manual'),payload->>'attention',nullif(payload->>'sourceUrl',''),coalesce(payload->>'userPrompt',''),nullif(payload->'aiGenerationContext','null'::jsonb),coalesce(payload->>'summary',''),coalesce(payload->>'inspiration',''),payload->>'imagePath',coalesce(payload->>'imageName',''),(payload->>'albumId')::uuid,coalesce(payload->>'status','pending')) returning *;
end; $$;

create function public.update_learning_record(target_id uuid, expected_version integer, patch jsonb, candidate_job_id uuid default null, discard_candidate boolean default false)
returns setof public.check_ins language plpgsql security invoker set search_path='' as $$
declare r public.check_ins%rowtype; c jsonb; owner_id uuid:=auth.uid(); updates jsonb:=coalesce(patch,'{}'::jsonb); content_before jsonb; content_changed boolean;
begin
  if owner_id is null then raise exception 'SESSION_EXPIRED'; end if;
  select * into r from public.check_ins where id=target_id and user_id=owner_id for update;
  if not found then raise exception 'RECORD_NOT_FOUND'; end if;
  -- An exact replay after a lost confirmation response returns the accepted record.
  if candidate_job_id is not null and r.accepted_ai_job_id=candidate_job_id and expected_version=r.version-1 then
    content_before:=jsonb_build_object('attention',r.attention,'summary',r.summary,'inspiration',r.inspiration,'sourceUrl',coalesce(public.normalize_learning_source_url(r.source_url),''),'userPrompt',r.user_prompt,'status',r.learning_status,'entryMode',r.entry_mode,'imagePath',r.image_path,'imageName',r.image_name,'albumId',r.album_id,'aiGenerationContext',r.ai_generation_context);
    if not exists(select 1 from jsonb_each(updates) p where content_before->p.key is distinct from p.value) then return next r; return; end if;
  end if;
  if expected_version is null or r.version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if exists(select 1 from jsonb_object_keys(updates) k where k not in ('attention','sourceUrl','summary','inspiration','imagePath','imageName','entryMode','userPrompt','aiGenerationContext','albumId','status')) then raise exception 'INVALID_RECORD_INPUT'; end if;
  if updates->>'albumId' is not null and not exists(select 1 from public.albums where id=(updates->>'albumId')::uuid and user_id=owner_id) then raise exception 'ALBUM_NOT_FOUND'; end if;
  if updates ? 'sourceUrl' and public.normalize_learning_source_url(nullif(updates->>'sourceUrl','')) is distinct from public.normalize_learning_source_url(r.source_url) and length(btrim(r.summary))>0 then raise exception 'SOURCE_CHANGE_REQUIRES_NEW_RECORD'; end if;
  c:=r.ai_candidate;
  if candidate_job_id is not null then
    if discard_candidate or c is null or c->>'jobId' is distinct from candidate_job_id::text then raise exception 'CANDIDATE_NOT_FOUND'; end if;
    if c->>'baseVersion' is distinct from r.version::text
      or public.normalize_learning_source_url(coalesce(r.source_url,'')) is distinct from c->>'sourceUrl'
      or coalesce(r.user_prompt,'') is distinct from coalesce(c->>'userPrompt','')
      or (updates ? 'sourceUrl' and public.normalize_learning_source_url(updates->>'sourceUrl') is distinct from public.normalize_learning_source_url(r.source_url))
      or (updates ? 'userPrompt' and updates->>'userPrompt' is distinct from r.user_prompt) then raise exception 'STALE_AI_CANDIDATE'; end if;
    if updates->>'status' is distinct from 'completed' then raise exception 'INVALID_RECORD_INPUT'; end if;
    -- Generated reflections are suggestions; never replace the learner's own reflection.
    updates:=jsonb_build_object('attention',c->'result'->>'attention','summary',c->'result'->>'summary') || updates || jsonb_build_object('entryMode','ai','aiGenerationContext',c->'generationContext');
    c:=null;
  elsif discard_candidate then c:=null;
  end if;
  content_before:=jsonb_build_object('attention',r.attention,'sourceUrl',coalesce(public.normalize_learning_source_url(r.source_url),''),'summary',r.summary,'inspiration',r.inspiration,'entryMode',r.entry_mode,'userPrompt',r.user_prompt,'aiGenerationContext',r.ai_generation_context,'imagePath',r.image_path,'imageName',r.image_name,'status',r.learning_status);
  content_changed := candidate_job_id is not null or exists(select 1 from jsonb_each(updates - 'albumId') p where content_before->p.key is distinct from p.value);
  return query update public.check_ins set
    attention=case when updates ? 'attention' then updates->>'attention' else r.attention end,
    source_url=case when updates ? 'sourceUrl' then nullif(updates->>'sourceUrl','') else r.source_url end,
    summary=case when updates ? 'summary' then updates->>'summary' else r.summary end,
    inspiration=case when updates ? 'inspiration' then updates->>'inspiration' else r.inspiration end,
    entry_mode=case when updates ? 'entryMode' then updates->>'entryMode' else r.entry_mode end,
    user_prompt=case when updates ? 'userPrompt' then updates->>'userPrompt' else r.user_prompt end,
    ai_generation_context=case when updates ? 'aiGenerationContext' then nullif(updates->'aiGenerationContext','null'::jsonb) else r.ai_generation_context end,
    image_path=case when updates ? 'imagePath' then updates->>'imagePath' else r.image_path end,
    image_name=case when updates ? 'imageName' then updates->>'imageName' else r.image_name end,
    album_id=case when updates ? 'albumId' then (updates->>'albumId')::uuid else r.album_id end,
    learning_status=case when updates ? 'status' then updates->>'status' else r.learning_status end,
    ai_candidate=c, accepted_ai_job_id=case when candidate_job_id is not null then candidate_job_id else r.accepted_ai_job_id end, version=r.version+case when content_changed then 1 else 0 end
    where id=target_id and user_id=owner_id returning *;
end; $$;

create function public.delete_learning_record(target_id uuid,expected_version integer)
returns setof public.check_ins language plpgsql security invoker set search_path='' as $$
declare r public.check_ins%rowtype;
begin
  if auth.uid() is null then raise exception 'SESSION_EXPIRED'; end if;
  select * into r from public.check_ins where id=target_id and user_id=(select auth.uid()) for update;
  if not found then raise exception 'RECORD_NOT_FOUND'; end if;
  if expected_version is null or r.version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  return query delete from public.check_ins where id=target_id and user_id=(select auth.uid()) returning *;
end; $$;

create function public.move_learning_records(record_ids uuid[],target_album_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare owned_count integer; owner_id uuid:=auth.uid();
begin
  if owner_id is null then raise exception 'SESSION_EXPIRED'; end if;
  if record_ids is null or cardinality(record_ids) not between 1 and 100 or array_position(record_ids,null) is not null
    or cardinality(record_ids)<>(select count(distinct id) from unnest(record_ids) id) then raise exception 'INVALID_RECORD_INPUT'; end if;
  -- Consistent lock order avoids deadlocks between intersecting bulk moves.
  perform 1 from public.check_ins where user_id=owner_id and id=any(record_ids) order by id for update;
  select count(*) into owned_count from public.check_ins where user_id=owner_id and id=any(record_ids);
  if owned_count<>cardinality(record_ids) then raise exception 'RECORD_NOT_FOUND'; end if;
  if target_album_id is not null then
    perform 1 from public.albums where id=target_album_id and user_id=owner_id for key share;
    if not found then raise exception 'ALBUM_NOT_FOUND'; end if;
  end if;
  update public.check_ins set album_id=target_album_id where user_id=owner_id and id=any(record_ids);
  return owned_count;
end; $$;

create function public.get_learning_albums()
returns table(id uuid,name text,description text,created_at timestamptz,updated_at timestamptz,record_count bigint,completed_count bigint)
language sql stable security invoker set search_path='' as $$
  select a.id,a.name,a.description,a.created_at,a.updated_at,count(r.id),count(r.id) filter(where r.learning_status='completed')
  from public.albums a left join public.check_ins r on r.album_id=a.id and r.user_id=a.user_id
  where a.user_id=(select auth.uid()) group by a.id order by a.created_at desc,a.id desc;
$$;
revoke all on function public.create_learning_record(uuid,jsonb),public.update_learning_record(uuid,integer,jsonb,uuid,boolean),public.delete_learning_record(uuid,integer),public.move_learning_records(uuid[],uuid),public.get_learning_albums() from public,anon,authenticated;
grant execute on function public.create_learning_record(uuid,jsonb),public.update_learning_record(uuid,integer,jsonb,uuid,boolean),public.delete_learning_record(uuid,integer),public.move_learning_records(uuid[],uuid),public.get_learning_albums() to authenticated;

create or replace function public.get_check_in_stats(target_today date)
returns table(total_count bigint,current_streak integer,has_today_record boolean)
language sql stable security invoker set search_path='' as $$
  with recursive completed as materialized (
    select distinct checkin_date from public.check_ins where user_id=(select auth.uid()) and learning_status='completed' and checkin_date <= target_today
  ), anchor as (
    select case when exists(select 1 from completed where checkin_date=target_today) then target_today else target_today-1 end as day
  ), streak(day,length) as (
    select anchor.day,0 from anchor union all select streak.day-1,streak.length+1 from streak where exists(select 1 from completed where checkin_date=streak.day)
  ) select (select count(*) from completed)::bigint,coalesce((select max(length) from streak),0)::integer,exists(select 1 from completed where checkin_date=target_today);
$$;
