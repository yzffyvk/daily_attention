// Opt-in preview only. No application route imports this module or sends its data to a server.
import type { CheckInRecord } from "@/features/checkins/types";
import type { AiGenerationJobData, AiGenerationQuota, CreateAiGenerationData } from "@/features/ai-generation/types";
import type { KnowledgeNarrative } from "@/lib/domain/knowledge-narrative";
import { validateNarrativeResult } from "@/lib/domain/knowledge-narrative";
import { createAiGenerationSchema } from "@/lib/domain/ai-generation";
import { getTodayKey } from "@/features/checkins/dates";
import { demoAiResult, demoDates, demoNarrativeResult, demoRecords, shiftDemoDate, sourceFromRecord } from "./demo-data";

const storageKey = "aura-acceptance-demo:v1";
type AiJob = { id: string; started: number; failure: boolean; cancelled: boolean; key: string; sourceUrl?: string; targetDate?: string; userPrompt?: string };
type NarrativeJob = { started: number; failure: boolean; key: string; cancelled?: boolean };
const quotaDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const quotaLimitMessage = "今日免费 2 次已用完，付费次数也不足；可购买次数包，或等待北京时间 0 点免费额度重置";
type DemoState = {
  version: 1; today: string;
  profile: { id: string; email: string; displayName: string; avatarKey: number; onboardingCompleted: boolean };
  records: CheckInRecord[]; narratives: KnowledgeNarrative[];
  aiJobs: AiJob[]; narrativeJobs: Record<string, NarrativeJob>; failNext: boolean;
};

function seed(today: string): DemoState {
  const records = demoRecords(today);
  const { related, mixed } = demoDates(today);
  const narratives = [related, mixed].map((dates, index): KnowledgeNarrative => {
    const sources = dates.map(date => sourceFromRecord(records.find(r => r.date === date && r.entryMode === (index ? "manual" : "ai"))!));
    const result = validateNarrativeResult(demoNarrativeResult(sources, today), dates);
    return { id: crypto.randomUUID(), title: result.title, result, sources, dates, question: "", status: "succeeded", changedDates: [], error: null, createdAt: `${today}T01:00:00Z`, updatedAt: `${today}T01:00:00Z` };
  });
  return { version: 1, today, profile: { id: `demo-${crypto.randomUUID()}`, email: "demo@example.invalid", displayName: "体验者", avatarKey: 2, onboardingCompleted: true }, records, narratives, aiJobs: [], narrativeJobs: {}, failNext: false };
}

export function installThemeDemoApi() {
  const originalFetch = window.fetch.bind(window);
  const today = getTodayKey();
  let state = seed(today);
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (saved?.version === 1 && saved.today === today && typeof saved.profile?.id === "string" && saved.profile.id.startsWith("demo-") && Array.isArray(saved.records) && Array.isArray(saved.narratives) && Array.isArray(saved.aiJobs) && saved.narrativeJobs) state = saved;
  } catch { /* Storage is optional; the demo still works in memory. */ }
  let revision = 0;
  const listeners = new Set<() => void>();
  function save() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Memory fallback. */ }
    revision++; listeners.forEach(listener => listener());
  }
  function takeFailure() { const fail = state.failNext; state.failNext = false; return fail; }
  function sharedQuota(): AiGenerationQuota {
    const now = Date.now();
    const requestDay = quotaDayFormatter.format(now);
    let reserved = 0, consumed = 0;
    const jobs = [
      ...state.aiJobs.map(job => ({ job, modelStartsAfter: 3500 })),
      ...Object.values(state.narrativeJobs).map(job => ({ job, modelStartsAfter: 1500 })),
    ];
    for (const { job, modelStartsAfter } of jobs) {
      if (job.cancelled || quotaDayFormatter.format(job.started) !== requestDay) continue;
      if (now - job.started < modelStartsAfter) reserved++;
      else consumed++;
    }
    const used = reserved + consumed;
    return { used, reserved, consumed, limit: 2, remaining: Math.max(0, 2 - used) };
  }
  function timestamp(previous?: string) { return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString(); }
  function advanceNarratives() {
    let changed = false;
    for (const item of state.narratives) {
      const job = state.narrativeJobs[item.id];
      if (!job || !["queued", "generating"].includes(item.status)) continue;
      const elapsed = Date.now() - job.started;
      const next = elapsed < 1500 ? "queued" : elapsed < 6500 ? "generating" : job.failure ? "failed" : "succeeded";
      if (item.status !== next) {
        item.status = next; item.updatedAt = timestamp(item.updatedAt); changed = true;
        if (next === "succeeded") { item.result = validateNarrativeResult(demoNarrativeResult(item.sources, today, item.question), item.dates); item.title = item.result.title; }
        if (next === "failed") item.error = "演示：生成服务暂时不可用。可以重新生成，体验恢复后的结果。";
      }
    }
    if (changed) save();
  }
  function withChanges(item: KnowledgeNarrative) {
    return { ...item, changedDates: item.sources.filter(source => state.records.find(r => r.date === source.date && r.entryMode === (source.entryMode ?? "manual"))?.version !== source.version).map(source => source.date) };
  }
  save();

  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const ok = (data: unknown, status = 200) => Response.json({ ok: true, data, requestId: "local-acceptance-demo" }, { status });
    const error = (message: string, code = "DEMO_ONLY", status = 400) => Response.json({ ok: false, error: { code, message }, requestId: "local-acceptance-demo" }, { status });
    if (url.origin !== location.origin) return error("演示模式不请求外部服务。");
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : input instanceof Request && method !== "GET" ? await input.clone().json() : {};
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const path = url.pathname;
    if (path === "/api/me" || path === "/api/onboarding") {
      if (method === "PATCH" || method === "POST") { state.profile = { ...state.profile, displayName: body.displayName ?? state.profile.displayName, avatarKey: body.avatarKey ?? state.profile.avatarKey }; save(); }
      return ok({ profile: state.profile });
    }
    if (path === "/api/checkins/stats") {
      const dates = new Set(state.records.map(r => r.date));
      const target = url.searchParams.get("today") ?? today;
      let cursor = dates.has(target) ? target : shiftDemoDate(target, -1), currentStreak = 0;
      while (dates.has(cursor)) { currentStreak++; cursor = shiftDemoDate(cursor, -1); }
      return ok({ totalCount: dates.size, currentStreak, hasTodayRecord: dates.has(target) });
    }
    if (path === "/api/checkins" && method === "GET") return ok(state.records.filter(r => r.date.startsWith(url.searchParams.get("month") ?? "")).map(r => ({ date: r.date, entryMode: r.entryMode, attention: r.attention, version: r.version, updatedAt: r.updatedAt, hasImage: Boolean(r.imagePath) })));
    if (/^\/api\/checkins\/\d{4}-\d{2}-\d{2}$/.test(path)) {
      const date = path.split("/").at(-1)!;
      const mode = body.entryMode ?? url.searchParams.get("mode") ?? "manual";
      let record = state.records.find(r => r.date === date && r.entryMode === mode);
      if (method === "PUT") {
        const now = timestamp(record?.updatedAt);
        const next: CheckInRecord = { id: record?.id ?? crypto.randomUUID(), date, entryMode: mode, attention: body.attention, sourceUrl: body.sourceUrl ?? "", userPrompt: mode === "ai" ? body.userPrompt ?? "" : "", aiGenerationContext: mode === "ai" ? body.aiGenerationContext ?? null : null, summary: body.summary ?? "", inspiration: body.inspiration ?? "", imagePath: null, imageUrl: null, imageName: "", version: (record?.version ?? 0) + 1, createdAt: record?.createdAt ?? now, updatedAt: now };
        state.records = state.records.filter(r => r !== record); state.records.push(next); record = next; save();
      }
      return record ? ok(record) : error("暂无记录", "NOT_FOUND", 404);
    }
    if (path === "/api/ai/generations" && method === "POST") {
      const parsed = createAiGenerationSchema.safeParse(body);
      if (!parsed.success) return error(parsed.error.issues[0].message, "VALIDATION_ERROR");
      let job = state.aiJobs.find(job => job.key === body.idempotencyKey);
      if (job && ((job.userPrompt ?? "") !== parsed.data.userPrompt || (job.sourceUrl !== undefined && job.sourceUrl !== parsed.data.sourceUrl) || (job.targetDate !== undefined && job.targetDate !== parsed.data.targetDate))) return error("提炼要求已变更，请重新生成。", "AI_IDEMPOTENCY_CONFLICT", 409);
      if (!job) {
        if (sharedQuota().remaining === 0) return error(quotaLimitMessage, "DAILY_AI_LIMIT_REACHED", 429);
        job = { id: crypto.randomUUID(), started: Date.now(), failure: takeFailure(), cancelled: false, key: body.idempotencyKey, sourceUrl: parsed.data.sourceUrl, targetDate: parsed.data.targetDate, userPrompt: parsed.data.userPrompt }; state.aiJobs.push(job); save();
      }
      const data: CreateAiGenerationData = { jobId: job.id, status: "queued", pollAfterMs: 1800, quota: sharedQuota(), generationContext: { userPrompt: job.userPrompt ?? "", promptVersion: "knowledge-questions-v1" } };
      return ok(data, 202);
    }
    if (path.startsWith("/api/ai/generations/")) {
      const job = state.aiJobs.find(job => job.id === path.split("/").at(-1));
      if (!job) return error("找不到示例任务，请重新生成。", "NOT_FOUND", 404);
      if (method === "DELETE") {
        if (job.cancelled || Date.now() - job.started >= 1500) return error("任务已经开始或结束，无法取消", "JOB_ALREADY_STARTED", 409);
        job.cancelled = true; save();
      }
      const elapsed = Date.now() - job.started;
      const data: AiGenerationJobData = job.cancelled ? { jobId: job.id, status: "cancelled", stage: "complete" }
        : elapsed < 1500 ? { jobId: job.id, status: "queued", stage: "queued" }
        : elapsed < 3500 ? { jobId: job.id, status: "fetching", stage: "fetching" }
        : elapsed < 6500 ? { jobId: job.id, status: "generating", stage: "generating" }
        : job.failure ? { jobId: job.id, status: "failed", stage: "complete", error: { code: "MODEL_SERVICE_ERROR", message: "演示：AI 服务暂时不可用。再次点击生成即可体验重试成功。", retryable: true } }
        : { jobId: job.id, status: "succeeded", stage: "complete", result: demoAiResult };
      return ok({ ...data, generationContext: { userPrompt: job.userPrompt ?? "", promptVersion: "knowledge-questions-v1" } });
    }
    if (path === "/api/ai/reflection-polish" && method === "POST") {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 900);
        signal?.addEventListener("abort", abort, { once: true });
      });
      signal?.throwIfAborted();
      const suggestion = `我的理解是：${String(body.answer).trim().replace(/[。.!！]+$/, "")}。下一步，我会用一个具体情境检验这段理解，而不只停留在复述概念。`;
      return ok({ polishedAnswer: suggestion.slice(0, body.maxLength ?? 2000), knowledgePoints: ["具体经历", "行为证据", "验证判断"], improvements: ["先表达核心理解，再说明下一步行动。", "保留原有观点，让表达顺序更清楚。"], cautions: ["这是固定演示建议，用于体验预览、采纳与撤销。"] });
    }
    if (path === "/api/knowledge-narratives") {
      advanceNarratives();
      if (method === "GET") return ok(state.narratives.map(withChanges));
      if (method === "POST") {
        const existing = state.narratives.find(item => state.narrativeJobs[item.id]?.key === body.idempotencyKey);
        if (existing) return ok(withChanges(existing), 202);
        const dates: string[] = Array.isArray(body.dates) ? [...new Set<string>(body.dates)].sort() : [];
        if (dates.length < 2 || dates.length > 14) return error("请选择 2–14 天的示例记录。", "VALIDATION_ERROR");
        const records = dates.map(date => state.records.find(r => r.date === date && r.entryMode === (body.entryMode ?? "manual")));
        if (records.some(r => !r)) return error("所选日期缺少该记录方式的已保存内容。", "SOURCE_NOT_FOUND");
        if (sharedQuota().remaining === 0) return error(quotaLimitMessage, "DAILY_AI_LIMIT_REACHED", 429);
        const sources = records.map(record => sourceFromRecord(record!));
        const result = demoNarrativeResult(sources, today, body.question);
        const now = timestamp();
        const item: KnowledgeNarrative = { id: crypto.randomUUID(), title: result.title, dates, question: body.question ?? "", sources, result: null, status: "queued", changedDates: [], error: null, createdAt: now, updatedAt: now };
        state.narrativeJobs[item.id] = { started: Date.now(), failure: takeFailure(), key: body.idempotencyKey };
        state.narratives.unshift(item); save(); return ok(item, 202);
      }
    }
    if (path.startsWith("/api/knowledge-narratives/")) {
      advanceNarratives();
      const id = path.split("/")[3];
      const item = state.narratives.find(item => item.id === id);
      if (!item) return error("找不到这条示例脉络。", "NOT_FOUND", 404);
      if (method === "DELETE") {
        const job = state.narrativeJobs[id];
        if (job && Date.now() - job.started < 1500) job.cancelled = true;
        // Keep started jobs in quota history even when their saved result is deleted.
        state.narratives = state.narratives.filter(item => item.id !== id); save(); return ok({ id });
      }
      if (method === "PATCH") {
        if (body.result) item.result = validateNarrativeResult(body.result, item.dates);
        else if (item.result) item.result.title = body.title;
        item.title = item.result?.title ?? body.title; item.updatedAt = timestamp(item.updatedAt); save();
      }
      if (method === "POST" && path.endsWith("/copy")) {
        const copy = structuredClone(item); copy.id = crypto.randomUUID(); copy.title += " · 副本";
        if (copy.result) copy.result.title = copy.title;
        copy.createdAt = copy.updatedAt = timestamp(); state.narratives.unshift(copy); save(); return ok(withChanges(copy), 201);
      }
      return ok(withChanges(item));
    }
    return error("此次演示提供 AI 提炼、知识串联与资料编辑；该操作暂未纳入演示。");
  };
  return {
    today, dates: demoDates(today), profile: state.profile,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getRevision: () => revision,
    willFail: () => state.failNext,
    toggleFailure() { state.failNext = !state.failNext; save(); },
    reset() { state = seed(today); save(); window.location.reload(); },
  };
}
export type DemoController = ReturnType<typeof installThemeDemoApi>;
