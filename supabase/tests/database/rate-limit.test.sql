begin;
select plan(24);

select results_eq(
  $$select * from public.consume_auth_rate_limit(decode(repeat('01', 32), 'hex'), 'login', 10, 900)$$,
  $$values (true, 0)$$,
  'the first request is allowed'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode(repeat('01', 32), 'hex') and action = 'login'),
  1,
  'the first request records attempt one'
);

select results_eq(
  $$select * from public.consume_auth_rate_limit(decode(repeat('01', 32), 'hex'), 'login', 10, 900)$$,
  $$values (true, 0)$$,
  'a request inside the window increments while below the limit'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode(repeat('01', 32), 'hex') and action = 'login'),
  2,
  'the second request increments the attempt count'
);
update private.auth_rate_limits
set attempt_count = 10
where bucket_digest = decode(repeat('01', 32), 'hex') and action = 'login';
select ok(
  (select not allowed from public.consume_auth_rate_limit(decode(repeat('01', 32), 'hex'), 'login', 10, 900)),
  'a request at the threshold is blocked'
);
select ok(
  (select retry_after_seconds > 0 from public.consume_auth_rate_limit(decode(repeat('01', 32), 'hex'), 'login', 10, 900)),
  'a blocked request includes a positive retry interval'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode(repeat('01', 32), 'hex') and action = 'login'),
  10,
  'blocking does not increment the attempt count'
);

insert into private.auth_rate_limits (bucket_digest, action, window_started_at, attempt_count, blocked_until)
values (decode(repeat('02', 32), 'hex'), 'recover', now() - interval '1801 seconds', 2, now() - interval '1 second');
select results_eq(
  $$select * from public.consume_auth_rate_limit(decode(repeat('02', 32), 'hex'), 'recover', 5, 1800)$$,
  $$values (true, 0)$$,
  'a request after the window resets is allowed'
);
select is(
  (select attempt_count from private.auth_rate_limits where bucket_digest = decode(repeat('02', 32), 'hex') and action = 'recover'),
  1,
  'a new window starts at attempt one'
);
select is(
  (select blocked_until from private.auth_rate_limits where bucket_digest = decode(repeat('02', 32), 'hex') and action = 'recover'),
  null,
  'a window reset clears the previous block'
);

create temporary table rate_limit_test_state (
  private_bucket_count bigint not null
) on commit drop;
insert into rate_limit_test_state (private_bucket_count)
select count(*) from private.auth_rate_limits;

select throws_ok(
  $$select * from public.consume_auth_rate_limit(null, 'login', 10, 900)$$,
  '22023', 'invalid auth rate limit parameters', 'a null bucket is rejected'
);
select is(
  (select count(*) from private.auth_rate_limits),
  (select private_bucket_count from rate_limit_test_state),
  'a null bucket does not modify private buckets'
);

select throws_ok(
  $$select * from public.consume_auth_rate_limit(decode('03', 'hex'), 'login', 10, 900)$$,
  '22023', 'invalid auth rate limit parameters', 'a short bucket is rejected'
);
select is(
  (select count(*) from private.auth_rate_limits where bucket_digest = decode('03', 'hex') and action = 'login'),
  0::bigint, 'a short bucket does not create a private row'
);

select throws_ok(
  $$select * from public.consume_auth_rate_limit(decode(repeat('04', 32), 'hex'), 'unknown', 1, 1)$$,
  '22023', 'invalid auth rate limit parameters', 'an unknown action is rejected'
);
select is(
  (select count(*) from private.auth_rate_limits where bucket_digest = decode(repeat('04', 32), 'hex') and action = 'unknown'),
  0::bigint, 'an unknown action does not create a private row'
);

select throws_ok(
  $$select * from public.consume_auth_rate_limit(decode(repeat('05', 32), 'hex'), 'register', 4, 3600)$$,
  '22023', 'invalid auth rate limit parameters', 'mismatched attempts are rejected'
);
select is(
  (select count(*) from private.auth_rate_limits where bucket_digest = decode(repeat('05', 32), 'hex') and action = 'register'),
  0::bigint, 'mismatched attempts do not create a private row'
);

select throws_ok(
  $$select * from public.consume_auth_rate_limit(decode(repeat('06', 32), 'hex'), 'register', 0, 3600)$$,
  '22023', 'invalid auth rate limit parameters', 'non-positive attempts are rejected'
);
select is(
  (select count(*) from private.auth_rate_limits where bucket_digest = decode(repeat('06', 32), 'hex') and action = 'register'),
  0::bigint, 'non-positive attempts do not create a private row'
);

select throws_ok(
  $$select * from public.consume_auth_rate_limit(decode(repeat('07', 32), 'hex'), 'register', 5, 3599)$$,
  '22023', 'invalid auth rate limit parameters', 'mismatched window is rejected'
);
select is(
  (select count(*) from private.auth_rate_limits where bucket_digest = decode(repeat('07', 32), 'hex') and action = 'register'),
  0::bigint, 'a mismatched window does not create a private row'
);

select throws_ok(
  $$select * from public.consume_auth_rate_limit(decode(repeat('08', 32), 'hex'), 'register', 5, 0)$$,
  '22023', 'invalid auth rate limit parameters', 'non-positive window is rejected'
);
select is(
  (select count(*) from private.auth_rate_limits where bucket_digest = decode(repeat('08', 32), 'hex') and action = 'register'),
  0::bigint, 'a non-positive window does not create a private row'
);

select * from finish();
rollback;
