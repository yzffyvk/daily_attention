-- Replayed POSTs may only acknowledge the complete content actually stored.
-- A changed local draft must receive a conflict, even after another tab has
-- advanced the cloud version; otherwise the caller could discard unsaved work.
create or replace function public.create_learning_record(target_id uuid, payload jsonb)
returns setof public.check_ins language plpgsql security invoker set search_path='' as $$
declare r public.check_ins%rowtype; owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'SESSION_EXPIRED'; end if;
  if target_id is null or payload is null then raise exception 'INVALID_RECORD_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_id::text,9211));
  select * into r from public.check_ins where id=target_id and user_id=owner_id for update;
  if found then
    -- Defaults match the INSERT below. Compare source identity canonically without
    -- rewriting the saved original URL. AI job metadata is not client-authored content.
    if r.checkin_date is distinct from (payload->>'date')::date
      or r.attention is distinct from payload->>'attention'
      or public.normalize_learning_source_url(r.source_url) is distinct from public.normalize_learning_source_url(nullif(payload->>'sourceUrl',''))
      or r.summary is distinct from coalesce(payload->>'summary','')
      or r.inspiration is distinct from coalesce(payload->>'inspiration','')
      or r.entry_mode is distinct from coalesce(payload->>'entryMode','manual')
      or r.user_prompt is distinct from coalesce(payload->>'userPrompt','')
      or r.ai_generation_context is distinct from nullif(payload->'aiGenerationContext','null'::jsonb)
      or r.image_path is distinct from payload->>'imagePath'
      or r.image_name is distinct from coalesce(payload->>'imageName','')
      or r.album_id is distinct from (payload->>'albumId')::uuid
      or r.learning_status is distinct from coalesce(payload->>'status','pending')
    then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return next r; return;
  end if;
  if payload->>'albumId' is not null and not exists(select 1 from public.albums where id=(payload->>'albumId')::uuid and user_id=owner_id) then raise exception 'ALBUM_NOT_FOUND'; end if;
  return query insert into public.check_ins(id,user_id,checkin_date,entry_mode,attention,source_url,user_prompt,ai_generation_context,summary,inspiration,image_path,image_name,album_id,learning_status)
    values(target_id,owner_id,(payload->>'date')::date,coalesce(payload->>'entryMode','manual'),payload->>'attention',nullif(payload->>'sourceUrl',''),coalesce(payload->>'userPrompt',''),nullif(payload->'aiGenerationContext','null'::jsonb),coalesce(payload->>'summary',''),coalesce(payload->>'inspiration',''),payload->>'imagePath',coalesce(payload->>'imageName',''),(payload->>'albumId')::uuid,coalesce(payload->>'status','pending')) returning *;
end; $$;
