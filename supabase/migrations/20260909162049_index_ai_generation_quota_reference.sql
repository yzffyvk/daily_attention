-- Cover the AI job -> daily quota composite foreign key.
-- Additive only: preserve jobs, quota counters, and existing indexes.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create index if not exists ai_generation_jobs_user_quota_date_idx
  on private.ai_generation_jobs (user_id, quota_date);
