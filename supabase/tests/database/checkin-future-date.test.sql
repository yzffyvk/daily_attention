begin;
select plan(5);

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000941', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'future-date@internal.invalid', '', now(), now(), now());
insert into public.profiles(id, email, display_name, avatar_key)
values ('00000000-0000-4000-8000-000000000941', 'future-date@example.com', '日期测试', 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000941","role":"authenticated"}', true);
select lives_ok($$insert into public.check_ins(user_id, checkin_date, attention)
  values ('00000000-0000-4000-8000-000000000941', (clock_timestamp() at time zone 'Asia/Shanghai')::date, 'today')$$,
  'today is writable through the authenticated Data API');
select lives_ok($$insert into public.check_ins(user_id, checkin_date, attention)
  values ('00000000-0000-4000-8000-000000000941', (clock_timestamp() at time zone 'Asia/Shanghai')::date - 1, 'yesterday')$$,
  'past dates remain writable');
select throws_ok($$insert into public.check_ins(user_id, checkin_date, attention)
  values ('00000000-0000-4000-8000-000000000941', (clock_timestamp() at time zone 'Asia/Shanghai')::date + 1, 'future manual')$$,
  'P0001', 'FUTURE_CHECKIN_DATE', 'future manual records are rejected');
select throws_ok($$insert into public.check_ins(user_id, checkin_date, entry_mode, attention)
  values ('00000000-0000-4000-8000-000000000941', (clock_timestamp() at time zone 'Asia/Shanghai')::date + 1, 'ai', 'future AI')$$,
  'P0001', 'FUTURE_CHECKIN_DATE', 'future AI records are rejected');
select throws_ok($$update public.check_ins set checkin_date = (clock_timestamp() at time zone 'Asia/Shanghai')::date + 2
  where user_id = '00000000-0000-4000-8000-000000000941' and attention = 'today'$$,
  'P0001', 'FUTURE_CHECKIN_DATE', 'records cannot be moved into the future');

reset role;
select * from finish();
rollback;
