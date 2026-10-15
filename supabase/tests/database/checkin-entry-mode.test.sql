begin;
select plan(17);

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mode-one@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mode-two@internal.invalid', '', now(), now(), now());
insert into public.profiles(id, email, display_name, avatar_key)
values ('00000000-0000-4000-8000-000000000901', 'mode-one@example.com', '模式测试一', 1),
  ('00000000-0000-4000-8000-000000000902', 'mode-two@example.com', '模式测试二', 2);
insert into public.check_ins(id, user_id, checkin_date, attention, summary, version)
values
  ('00000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000901', '2026-09-15', 'manual yesterday', 'manual summary', 4),
  ('00000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000901', '2026-09-16', 'manual today', 'manual summary', 7);

select has_column('public', 'check_ins', 'entry_mode', 'records have an entry mode');
select col_not_null('public', 'check_ins', 'entry_mode', 'entry mode cannot be null');
select lives_ok($$insert into public.check_ins(user_id, checkin_date, entry_mode, attention)
  values ('00000000-0000-4000-8000-000000000901', '2026-09-16', 'ai', 'AI today'),
    ('00000000-0000-4000-8000-000000000901', '2026-09-14', 'ai', 'AI only day')$$,
  'manual and AI records coexist on the same account and date');
select lives_ok($$insert into public.check_ins(user_id, checkin_date, entry_mode, attention)
  values ('00000000-0000-4000-8000-000000000901', '2026-09-16', 'ai', 'another AI')$$,
  'multiple records in the same mode and date are independent');
select throws_ok($$insert into public.check_ins(user_id, checkin_date, entry_mode, attention)
  values ('00000000-0000-4000-8000-000000000901', '2026-09-17', 'other', 'invalid mode')$$,
  '23514', null, 'unsupported entry modes are rejected');
select throws_ok($$insert into public.check_ins(user_id, checkin_date, entry_mode, attention)
  values ('00000000-0000-4000-8000-000000000901', '2026-09-17', null, 'null mode')$$,
  '23502', null, 'null entry modes are rejected');
select results_eq($$select id, entry_mode, attention, summary, version from public.check_ins
  where id = '00000000-0000-4000-8000-000000000912'$$,
  $$values ('00000000-0000-4000-8000-000000000912'::uuid, 'manual'::text, 'manual today'::varchar, 'manual summary'::text, 7)$$,
  'omitted mode retains the legacy manual identity and content');

update public.check_ins set attention = 'changed AI', version = version + 1
where user_id = '00000000-0000-4000-8000-000000000901' and checkin_date = '2026-09-16' and entry_mode = 'ai';
select is((select version from public.check_ins where id = '00000000-0000-4000-8000-000000000912'), 7,
  'editing AI preserves the manual version');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000901","role":"authenticated"}', true);
select results_eq($$select total_count, current_streak, has_today_record from public.get_check_in_stats('2026-09-16')$$,
  $$values (3::bigint, 3, true)$$, 'statistics count distinct dates including AI-only days');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000902","role":"authenticated"}', true);
select results_eq($$select total_count, current_streak, has_today_record from public.get_check_in_stats('2026-09-16')$$,
  $$values (0::bigint, 0, false)$$, 'statistics remain scoped to the authenticated account');
reset role;

select lives_ok($$create temporary table mode_narrative as select * from public.create_knowledge_narrative(
  '00000000-0000-4000-8000-000000000901', array['2026-09-15'::date, '2026-09-16'::date], '',
  '00000000-0000-4000-8000-000000000921')$$,
  'date-only narrative generation accepts dates containing both modes');
select results_eq($$select source->>'id', source->>'entryMode', source->>'attention'
  from mode_narrative, jsonb_array_elements(source_snapshot) source order by source->>'date'$$,
  $$values ('00000000-0000-4000-8000-000000000911'::text, 'manual'::text, 'manual yesterday'::text),
    ('00000000-0000-4000-8000-000000000912'::text, 'manual'::text, 'manual today'::text)$$,
  'new narrative snapshots preserve source IDs and select only manual legacy dates');
select function_privs_are('public', 'create_knowledge_narrative', array['uuid','date[]','text','uuid','text'], 'authenticated', array[]::text[],
  'authenticated clients cannot invoke the privileged narrative function');
select function_privs_are('public', 'create_knowledge_narrative', array['uuid','date[]','text','uuid','text'], 'service_role', array['EXECUTE'],
  'only the existing privileged server role can create narratives');

insert into public.check_ins(id, user_id, checkin_date, entry_mode, attention)
values ('00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000901', '2026-09-12', 'ai', 'AI first only'),
  ('00000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000901', '2026-09-13', 'ai', 'AI second only');
select lives_ok($$create temporary table ai_mode_narrative as select * from public.create_knowledge_narrative(
  '00000000-0000-4000-8000-000000000901', array['2026-09-12'::date, '2026-09-13'::date], '',
  '00000000-0000-4000-8000-000000000922', 'ai')$$,
  'AI-only days can create an independent narrative');
select results_eq($$select source->>'id', source->>'entryMode', source->>'attention'
  from ai_mode_narrative, jsonb_array_elements(source_snapshot) source order by source->>'date'$$,
  $$values ('00000000-0000-4000-8000-000000000913'::text, 'ai'::text, 'AI first only'::text),
    ('00000000-0000-4000-8000-000000000914'::text, 'ai'::text, 'AI second only'::text)$$,
  'AI narrative snapshots reference AI record IDs');
select throws_ok($$select public.create_knowledge_narrative('00000000-0000-4000-8000-000000000901',
  array['2026-09-15'::date, '2026-09-16'::date], '', '00000000-0000-4000-8000-000000000921', 'ai')$$,
  'P0001', 'NARRATIVE_IDEMPOTENCY_CONFLICT', 'a narrative request cannot reuse its key for another mode');

select * from finish();
rollback;
