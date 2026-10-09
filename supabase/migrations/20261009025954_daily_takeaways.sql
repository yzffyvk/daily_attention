create table public.daily_takeaway_lessons (
  id text primary key check (id ~ '^tennis-[0-9]{2}$'),
  sequence integer not null unique check (sequence > 0),
  version integer not null check (version > 0),
  content jsonb not null,
  published boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint takeaway_content_identity check (
    jsonb_typeof(content) = 'object' and content->>'id' = id
    and (content->>'version')::integer = version
    and (content->>'sequence')::integer = sequence
    and content->>'domain' = 'tennis'
    and jsonb_array_length(content->'quiz'->'options') = 2
    and (content->'quiz'->>'correctIndex')::integer in (0, 1)
  ),
  constraint takeaway_publication_review check (
    not published or (nullif(btrim(reviewed_by), '') is not null and reviewed_at is not null)
  )
);

create table public.daily_takeaway_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id text not null references public.daily_takeaway_lessons(id) on delete cascade,
  status text not null check (status in ('collected', 'skipped')),
  learning_date date not null,
  content_version integer not null check (content_version > 0),
  acted_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create unique index daily_takeaway_one_collection_per_day
  on public.daily_takeaway_progress(user_id, learning_date) where status = 'collected';
create index daily_takeaway_progress_lesson on public.daily_takeaway_progress(lesson_id);

create table public.daily_takeaway_quiz_results (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id text not null references public.daily_takeaway_lessons(id) on delete cascade,
  content_version integer not null check (content_version > 0),
  answer_index integer not null check (answer_index in (0, 1)),
  correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index daily_takeaway_quiz_lesson on public.daily_takeaway_quiz_results(lesson_id);

alter table public.daily_takeaway_lessons enable row level security;
alter table public.daily_takeaway_progress enable row level security;
alter table public.daily_takeaway_quiz_results enable row level security;
revoke all on public.daily_takeaway_lessons, public.daily_takeaway_progress, public.daily_takeaway_quiz_results from anon, authenticated;
grant select on public.daily_takeaway_lessons, public.daily_takeaway_progress, public.daily_takeaway_quiz_results to authenticated;
grant all on public.daily_takeaway_lessons, public.daily_takeaway_progress, public.daily_takeaway_quiz_results to service_role;
create policy takeaway_published_content on public.daily_takeaway_lessons for select to authenticated using (published);
create policy takeaway_owned_progress on public.daily_takeaway_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy takeaway_owned_quizzes on public.daily_takeaway_quiz_results for select to authenticated using ((select auth.uid()) = user_id);

create function public.get_daily_takeaway_state(target_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  learning_today date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  current_lesson jsonb := null;
  collected_history jsonb;
  quiz_results jsonb;
begin
  if target_user_id is null or not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'TAKEAWAY_ACCOUNT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.daily_takeaway_progress where user_id = target_user_id and status = 'collected' and learning_date = learning_today) then
    select l.content into current_lesson from public.daily_takeaway_lessons l
    where l.published and not exists (select 1 from public.daily_takeaway_progress p where p.user_id = target_user_id and p.lesson_id = l.id)
    order by l.sequence limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson', l.content, 'collectedAt', p.acted_at, 'learningDate', p.learning_date, 'collectedVersion', p.content_version
  ) order by p.learning_date desc, p.acted_at desc), '[]'::jsonb) into collected_history
  from public.daily_takeaway_progress p join public.daily_takeaway_lessons l on l.id = p.lesson_id
  where p.user_id = target_user_id and p.status = 'collected';
  select coalesce(jsonb_agg(jsonb_build_object(
    'lessonId', lesson_id, 'version', content_version, 'answerIndex', answer_index, 'correct', correct, 'answeredAt', answered_at
  ) order by answered_at desc), '[]'::jsonb) into quiz_results
  from public.daily_takeaway_quiz_results where user_id = target_user_id;
  return jsonb_build_object(
    'today', learning_today, 'timeZone', 'Asia/Shanghai',
    'nextAvailableAt', (learning_today + 1)::timestamp at time zone 'Asia/Shanghai',
    'totalLessons', (select count(*) from public.daily_takeaway_lessons where published),
    'skippedCount', (select count(*) from public.daily_takeaway_progress where user_id = target_user_id and status = 'skipped'),
    'currentLesson', current_lesson, 'history', collected_history, 'quizResults', quiz_results
  );
end;
$$;

create function public.apply_daily_takeaway_action(
  target_user_id uuid, target_lesson_id text, target_version integer, target_action text, target_answer integer default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  lesson public.daily_takeaway_lessons;
  previous_status text;
  next_id text;
  action_time timestamptz;
  learning_today date;
begin
  if target_user_id is null or not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'TAKEAWAY_ACCOUNT_NOT_FOUND';
  end if;
  if target_action is null or target_action not in ('collect', 'skip', 'quiz') or target_version is null or target_version < 1 then
    raise exception 'TAKEAWAY_INVALID_ACTION';
  end if;
  if (target_action = 'quiz' and (target_answer is null or target_answer not in (0, 1)))
    or (target_action <> 'quiz' and target_answer is not null) then
    raise exception 'TAKEAWAY_INVALID_ACTION';
  end if;

  -- Serialize all devices for an account, then derive the date from the server clock.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text || ':daily-takeaway', 0));
  action_time := clock_timestamp();
  learning_today := (action_time at time zone 'Asia/Shanghai')::date;
  select * into lesson from public.daily_takeaway_lessons where id = target_lesson_id for share;
  if not found then raise exception 'TAKEAWAY_NOT_FOUND'; end if;
  select status into previous_status from public.daily_takeaway_progress
    where user_id = target_user_id and lesson_id = target_lesson_id;

  if (target_action = 'collect' and previous_status = 'collected') or (target_action = 'skip' and previous_status = 'skipped') then
    return public.get_daily_takeaway_state(target_user_id);
  end if;
  if not lesson.published and not (target_action = 'quiz' and previous_status = 'collected') then
    raise exception 'TAKEAWAY_NOT_FOUND';
  end if;
  if lesson.version <> target_version then raise exception 'TAKEAWAY_CONTENT_UPDATED'; end if;

  if not (target_action = 'quiz' and previous_status = 'collected') then
    if exists (select 1 from public.daily_takeaway_progress where user_id = target_user_id and status = 'collected' and learning_date = learning_today) then
      raise exception 'DAILY_TAKEAWAY_DONE';
    end if;
    select l.id into next_id from public.daily_takeaway_lessons l
    where l.published and not exists (select 1 from public.daily_takeaway_progress p where p.user_id = target_user_id and p.lesson_id = l.id)
    order by l.sequence limit 1;
    if next_id is distinct from target_lesson_id then raise exception 'TAKEAWAY_PROGRESS_CHANGED'; end if;
  end if;

  if target_action = 'quiz' then
    insert into public.daily_takeaway_quiz_results(user_id, lesson_id, content_version, answer_index, correct, answered_at)
    values (target_user_id, target_lesson_id, lesson.version, target_answer, target_answer = (lesson.content->'quiz'->>'correctIndex')::integer, action_time)
    on conflict (user_id, lesson_id) do update set content_version = excluded.content_version,
      answer_index = excluded.answer_index, correct = excluded.correct, answered_at = excluded.answered_at;
  else
    insert into public.daily_takeaway_progress(user_id, lesson_id, status, learning_date, content_version, acted_at)
    values (target_user_id, target_lesson_id, case target_action when 'collect' then 'collected' else 'skipped' end, learning_today, lesson.version, action_time);
  end if;
  return public.get_daily_takeaway_state(target_user_id);
end;
$$;

-- Writes go through a verified server session; direct client table writes are disabled.
revoke all on function public.get_daily_takeaway_state(uuid) from public, anon, authenticated;
revoke all on function public.apply_daily_takeaway_action(uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.get_daily_takeaway_state(uuid) to service_role;
grant execute on function public.apply_daily_takeaway_action(uuid, text, integer, text, integer) to service_role;

-- Reviewed content remains the historical reading version even after withdrawal.
create function private.guard_daily_takeaway_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.reviewed_at is not null then
    if new.reviewed_at is null or nullif(btrim(new.reviewed_by), '') is null then
      raise exception 'TAKEAWAY_REVIEW_REQUIRED';
    end if;
    if new.id is distinct from old.id or new.sequence is distinct from old.sequence then
      raise exception 'TAKEAWAY_PUBLISHED_IDENTITY_IMMUTABLE';
    end if;
    if new.content is distinct from old.content and (
      not new.published or new.version <= old.version or new.reviewed_at <= old.reviewed_at
      or nullif(btrim(new.content->>'correctionNote'), '') is null
    ) then
      raise exception 'TAKEAWAY_REVIEW_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_daily_takeaway_review() from public, anon, authenticated;
create trigger daily_takeaway_review_guard before update on public.daily_takeaway_lessons
for each row execute function private.guard_daily_takeaway_review();
