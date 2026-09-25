-- Cover the knowledge narrative -> daily quota composite foreign key.
-- Additive only: preserve saved results, quota counters, and existing indexes.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create index if not exists knowledge_narratives_user_quota_date_idx
  on public.knowledge_narratives (user_id, quota_date);
