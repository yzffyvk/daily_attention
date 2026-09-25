-- Saved narrative management never queues generation or consumes AI quota.
-- Separate copy keys keep copy retries distinct from generation retries.
alter table public.knowledge_narratives
  add column copy_source_id uuid,
  add column copy_request_key uuid,
  add constraint narrative_copy_key_unique unique (user_id, copy_request_key),
  add constraint narrative_copy_origin_check check ((copy_source_id is null) = (copy_request_key is null));

create function public.update_knowledge_narrative(
  target_user_id uuid, target_id uuid, target_result jsonb default null,
  target_title text default null, target_expected_updated_at timestamptz default null
) returns setof public.knowledge_narratives
language plpgsql security definer set search_path = '' as $$
declare
  item public.knowledge_narratives%rowtype;
  edited_result jsonb;
  edited_title text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 6401));
  select * into item from public.knowledge_narratives where user_id = target_user_id and id = target_id for update;
  if not found then raise exception 'NARRATIVE_NOT_FOUND'; end if;
  if item.status <> 'succeeded' then raise exception 'NARRATIVE_NOT_READY'; end if;
  if target_expected_updated_at is not null and target_expected_updated_at <> item.updated_at then
    raise exception 'NARRATIVE_EDIT_CONFLICT';
  end if;
  if target_result is not null then
    if target_title is not null or target_expected_updated_at is null or jsonb_typeof(target_result) <> 'object' then
      raise exception 'NARRATIVE_EDIT_INVALID';
    end if;
    edited_result := target_result;
    edited_title := btrim(target_result->>'title');
  else
    edited_title := btrim(target_title);
    edited_result := item.result;
  end if;
  if edited_title is null or length(edited_title) not between 1 and 120 then raise exception 'NARRATIVE_EDIT_INVALID'; end if;
  -- The authenticated server validates the full result and owned source citations.
  return query update public.knowledge_narratives
    set title = edited_title, result = jsonb_set(edited_result, '{title}', to_jsonb(edited_title)),
      updated_at = greatest(clock_timestamp(), item.updated_at + interval '1 microsecond')
    where id = item.id returning *;
end;
$$;

create function public.copy_knowledge_narrative(target_user_id uuid, target_id uuid, target_idempotency_key uuid)
returns setof public.knowledge_narratives
language plpgsql security definer set search_path = '' as $$
declare
  source_item public.knowledge_narratives%rowtype;
  existing public.knowledge_narratives%rowtype;
  copy_title text;
  suffix text;
  title_character text;
  character_units integer;
  title_units integer;
  counter integer := 1;
begin
  if target_user_id is null or target_id is null or target_idempotency_key is null then raise exception 'NARRATIVE_INVALID_INPUT'; end if;
  -- Select the name and insert under one account lock, including simultaneous clicks in other tabs.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 6401));
  select * into existing from public.knowledge_narratives where user_id = target_user_id and copy_request_key = target_idempotency_key;
  if found then
    if existing.copy_source_id <> target_id then raise exception 'NARRATIVE_IDEMPOTENCY_CONFLICT'; end if;
    return next existing; return;
  end if;
  select * into source_item from public.knowledge_narratives where user_id = target_user_id and id = target_id for update;
  if not found then raise exception 'NARRATIVE_NOT_FOUND'; end if;
  if source_item.status <> 'succeeded' then raise exception 'NARRATIVE_NOT_READY'; end if;
  loop
    suffix := case when counter = 1 then ' cp' else ' ' || counter::text || ' cp' end;
    -- Match the API's UTF-16 length limit while preserving complete Unicode characters.
    copy_title := '';
    title_units := length(suffix);
    for title_character in select regexp_split_to_table(source_item.title, '') loop
      character_units := case when ascii(title_character) > 65535 then 2 else 1 end;
      exit when title_units + character_units > 120;
      copy_title := copy_title || title_character;
      title_units := title_units + character_units;
    end loop;
    copy_title := copy_title || suffix;
    exit when not exists (select 1 from public.knowledge_narratives where user_id = target_user_id and title = copy_title);
    counter := counter + 1;
  end loop;
  return query insert into public.knowledge_narratives(
    user_id,idempotency_key,copy_source_id,copy_request_key,dates,question,title,source_snapshot,result,
    status,quota_date,started_at,finished_at
  ) values (
    target_user_id,gen_random_uuid(),source_item.id,target_idempotency_key,source_item.dates,source_item.question,
    copy_title,source_item.source_snapshot,jsonb_set(source_item.result,'{title}',to_jsonb(copy_title)),
    'succeeded',source_item.quota_date,clock_timestamp(),clock_timestamp()
  ) returning *;
end;
$$;

create function public.delete_knowledge_narrative(target_user_id uuid, target_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare item public.knowledge_narratives%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 6401));
  select * into item from public.knowledge_narratives where user_id = target_user_id and id = target_id for update;
  if not found then raise exception 'NARRATIVE_NOT_FOUND'; end if;
  -- Row locking races safely with worker claim/finish. Started attempts remain consumed.
  if item.started_at is null and item.status = 'queued' then
    update private.ai_daily_quotas set reserved_count = reserved_count - 1, updated_at = now()
      where user_id = item.user_id and quota_date = item.quota_date;
  end if;
  delete from public.knowledge_narratives where id = item.id;
  return true;
end;
$$;

revoke all on function public.update_knowledge_narrative(uuid,uuid,jsonb,text,timestamptz) from public, anon, authenticated;
revoke all on function public.copy_knowledge_narrative(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.delete_knowledge_narrative(uuid,uuid) from public, anon, authenticated;
grant execute on function public.update_knowledge_narrative(uuid,uuid,jsonb,text,timestamptz) to service_role;
grant execute on function public.copy_knowledge_narrative(uuid,uuid,uuid) to service_role;
grant execute on function public.delete_knowledge_narrative(uuid,uuid) to service_role;
