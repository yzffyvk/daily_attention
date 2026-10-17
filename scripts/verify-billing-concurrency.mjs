import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Only the project's existing local test container is reachable from this harness.
const container = 'supabase_db_supabase-web-v1';
const args = ['exec', '-i', container, 'psql', '-XAtq', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
function sql(query) {
  const result = spawnSync('docker', [...args, '-c', query], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error(result.stderr || 'local database query failed');
  return result.stdout.trim();
}
function session(name) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', exited = false;
  const pending = new Set();
  child.stdout.on('data', data => { output += data; for (const check of pending) check(); });
  child.stderr.on('data', data => { errors += data; });
  child.on('exit', () => { exited = true; for (const check of pending) check(); });
  child.stdin.write(`set application_name='${name}'; set statement_timeout='5s';\n`);
  return {
    send(query) {
      const marker = `DONE_${randomUUID().replaceAll('-', '')}`;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(check); reject(new Error('billing concurrency timeout')); }, 8_000);
        const check = () => {
          if (output.includes(marker)) { clearTimeout(timer); pending.delete(check); resolve(); }
          else if (exited) { clearTimeout(timer); pending.delete(check); reject(new Error(errors || 'database session exited')); }
        };
        pending.add(check);
        child.stdin.write(`${query}\n\\echo ${marker}\n`);
      });
      return promise;
    },
    close() { if (!exited) child.stdin.end('rollback;\n\\q\n'); },
  };
}

const owner = randomUUID(), key = randomUUID(), suffix = randomUUID().replaceAll('-', '');
let jobId;
const creator = session(`billing_creator_${suffix}`), worker = session(`billing_worker_${suffix}`);
try {
  const pair = sql(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
    values('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','billing-lock-${suffix}@internal.invalid','',now(),now(),now());
    select (j.job).id::text||'|'||(j.job).record_id::text from public.create_ai_generation_job('${owner}',(now() at time zone 'Asia/Shanghai')::date,'${key}','https://example.com/billing-lock','example.com','') j;`);
  const [id, recordId] = pair.split('\n').at(-1).split('|'); jobId = id;
  sql(`do $$begin perform public.claim_ai_generation_job('${jobId}'); perform public.begin_ai_generation('${jobId}'); end$$;`);
  await creator.send(`begin; set local deadlock_timeout='100ms'; select 1 from private.ai_daily_quotas where user_id='${owner}' for update;`);
  const settling = worker.send(`begin; set local deadlock_timeout='100ms';
    select public.mark_ai_generation_provider_failure('${jobId}','MODEL_SERVICE_ERROR','fixture failure',false,1,1,0,1,1,0); commit;`)
    .then(() => null, error => error);
  let blocked = false;
  for (let i = 0; i < 50; i++) {
    if (sql(`select coalesce(bool_or(wait_event_type='Lock'),false) from pg_stat_activity where application_name='billing_worker_${suffix}'`) === 't') { blocked = true; break; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(blocked, 'worker must be waiting for the quota row held by creator');
  await creator.send(`do $$begin
    perform public.create_record_ai_generation_job('${owner}',(now() at time zone 'Asia/Shanghai')::date,'${randomUUID()}',
      'https://example.com/billing-lock','example.com','','${recordId}');
    raise exception 'expected the existing running job to remain busy';
    exception when others then if sqlerrm <> 'AI_RECORD_BUSY' then raise; end if;
    end$$; rollback;`);
  const failure = await settling;
  if (failure) throw failure;
  assert.equal(sql(`select status from private.ai_generation_jobs where id='${jobId}'`), 'failed');
  assert.equal(sql(`select consumed_count from private.ai_daily_quotas where user_id='${owner}'`), '0');
  console.log('PASS: concurrent provider failure and record regeneration settle without a quota/record deadlock; failed generation refunds once.');
} finally {
  creator.close(); worker.close();
  // Test-created local identity and its queue message only; no existing data is touched.
  if (jobId) sql(`delete from pgmq.q_ai_generation_jobs where message->>'job_id'='${jobId}';`);
  sql(`delete from auth.users where id='${owner}';`);
}
