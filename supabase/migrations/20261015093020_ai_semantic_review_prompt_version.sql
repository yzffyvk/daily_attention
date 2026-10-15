-- Deploy the worker supporting knowledge-recall-v2 before changing this default.
-- Existing jobs retain their immutable version snapshot and previous behavior.
alter table private.ai_generation_jobs
  alter column prompt_version set default 'knowledge-recall-v2';
