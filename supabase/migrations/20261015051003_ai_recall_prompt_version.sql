-- Deploy the worker supporting knowledge-recall-v1 before applying this default.
-- Existing jobs keep their original prompt-version snapshot.
alter table private.ai_generation_jobs
  alter column prompt_version set default 'knowledge-recall-v1';
