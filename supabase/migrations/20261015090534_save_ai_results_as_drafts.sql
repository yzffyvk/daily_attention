-- AI results use the same draft and completion save paths as manual records.
create or replace function public.update_learning_record(target_id uuid, expected_version integer, patch jsonb, candidate_job_id uuid default null, discard_candidate boolean default false)
returns setof public.check_ins language plpgsql security invoker set search_path='' as $$
declare r public.check_ins%rowtype; c jsonb; owner_id uuid:=auth.uid(); updates jsonb:=coalesce(patch,'{}'::jsonb); content_before jsonb; content_changed boolean;
begin
  if owner_id is null then raise exception 'SESSION_EXPIRED'; end if;
  select * into r from public.check_ins where id=target_id and user_id=owner_id for update;
  if not found then raise exception 'RECORD_NOT_FOUND'; end if;
  -- An exact replay after a lost save response returns the accepted record.
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
