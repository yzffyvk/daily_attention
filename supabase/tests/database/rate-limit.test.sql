begin;
select plan(10);

select results_eq(
  $$select * from public.consume_auth_rate_limit(decode('0101', 'hex'), 'login', 2, 60)$$,
  $$values (true, 0)$$,
  'the first request is allowed'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode('0101', 'hex') and action = 'login'),
  1,
  'the first request records attempt one'
);

select results_eq(
  $$select * from public.consume_auth_rate_limit(decode('0101', 'hex'), 'login', 2, 60)$$,
  $$values (true, 0)$$,
  'a request inside the window increments while below the limit'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode('0101', 'hex') and action = 'login'),
  2,
  'the second request increments the attempt count'
);
select ok(
  (select not allowed from public.consume_auth_rate_limit(decode('0101', 'hex'), 'login', 2, 60)),
  'a request at the threshold is blocked'
);
select ok(
  (select retry_after_seconds > 0 from public.consume_auth_rate_limit(decode('0101', 'hex'), 'login', 2, 60)),
  'a blocked request includes a positive retry interval'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode('0101', 'hex') and action = 'login'),
  2,
  'blocking does not increment the attempt count'
);

insert into private.auth_rate_limits (bucket_digest, action, window_started_at, attempt_count, blocked_until)
values (decode('0202', 'hex'), 'recover', now() - interval '61 seconds', 2, now() - interval '1 second');
select results_eq(
  $$select * from public.consume_auth_rate_limit(decode('0202', 'hex'), 'recover', 2, 60)$$,
  $$values (true, 0)$$,
  'a request after the window resets is allowed'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode('0202', 'hex') and action = 'recover'),
  1,
  'a new window starts at attempt one'
);
select is(
  (select blocked_until from private.auth_rate_limits where bucket_digest = decode('0202', 'hex') and action = 'recover'),
  null,
  'a window reset clears the previous block'
);

select * from finish();
rollback;
