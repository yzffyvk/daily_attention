// Creates only a dedicated local demo account. Never overwrites existing notes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";

const environment = parseEnv(await readFile(".dev.vars", "utf8"));
const database = new URL(environment.NEXT_PUBLIC_SUPABASE_URL);
if (database.origin !== "http://127.0.0.1:54321") {
  throw new Error("演示初始化只允许本地数据库 http://127.0.0.1:54321");
}
const origin = "http://127.0.0.1:3000";
if (environment.APP_ORIGIN !== origin) throw new Error("本地演示需要 APP_ORIGIN=http://127.0.0.1:3000");
const directory = "work/local-demo";
await mkdir(directory, { recursive: true, mode: 0o700 });
const accountFile = `${directory}/account.json`;
let account;
try { account = JSON.parse(await readFile(accountFile, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  account = { email: `demo-${Date.now()}@aura.local`, password: `Aura-${randomBytes(12).toString("base64url")}` };
  await writeFile(accountFile, JSON.stringify(account, null, 2), { mode: 0o600, flag: "wx" });
}
if (!/^demo-\d+@aura\.local$/.test(account.email)) throw new Error("无效的本地演示账号");
let cookie = "";
async function request(path, method = "GET", body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map(value => value.split(";", 1)[0]).join("; ");
  const data = await response.json();
  return { status: response.status, ...data };
}
function checked(result) {
  if (!result.ok) throw new Error(`${result.status}: ${result.error?.message ?? "本地请求失败"}`);
  return result.data;
}
if (!account.userId) {
  const created = checked(await request("/api/auth/register", "POST", { email: account.email, password: account.password }));
  account.userId = created.profile.id;
  account.recoveryCode = created.recoveryCode;
  await writeFile(accountFile, JSON.stringify(account, null, 2), { mode: 0o600 });
}
checked(await request("/api/auth/login", "POST", { email: account.email, password: account.password }));
checked(await request("/api/onboarding", "POST", { displayName: "知序演示", avatarKey: 2 }));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const notes = [
  { offset: -6, attention: "Agent 学习 ①：工具与外部知识", summary: "【演示准备笔记】\n语言模型基于上下文生成回答，但不能仅凭参数可靠获得实时数据。检索把相关外部资料加入上下文，工具调用让模型请求执行查询或操作。\n\n增强型语言模型可以组合检索、工具和记忆。检索帮助回答有据可查的问题，工具提供外部能力，记忆保存跨步骤需要的信息。它们扩展能力，但并不自动保证答案正确。", inspiration: "我把模型看作负责理解和决策的部分，把检索看作资料入口，把工具看作行动接口。每次工具执行都需要明确输入与结果。" },
  { offset: -4, attention: "Agent 学习 ②：工作流与自主 Agent", summary: "【演示准备笔记】\n工作流用预先定义的步骤组织模型与工具。提示词链适合可分解成固定顺序的任务；路由先分类，再分配给合适处理方式；并行化可同时处理独立子任务。\n\n自主 Agent 根据反馈动态决定下一步，在任务路径难以提前固定时更灵活，但增加成本、延迟和出错的不确定性。优先使用能解决问题的简单方案，不要为了自主性而增加复杂度。", inspiration: "我会先判断任务能否清晰拆成固定步骤。如果可以，先做工作流；如果下一步依赖不断变化的环境反馈，再考虑 Agent。" },
  { offset: -2, attention: "Agent 学习 ③：评估与反馈循环", summary: "【演示准备笔记】\n评估优化工作流让一个模型生成候选结果，另一个步骤依据明确标准给出反馈，再改进结果。反馈循环适用于评价标准清晰、迭代确实能改善结果的任务。\n\n自主系统应设置停止条件、最大轮数和人工检查点。评估应观察任务是否完成、工具是否正确使用以及成本与延迟，不能只判断回答是否流畅。工具返回值和外部环境提供下一步决策依据。", inspiration: "反馈循环不是无限重试。要先定义成功标准和停止条件，再观察改进是否值得新增的调用成本。" },
];
const dates = [];
for (const note of notes) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + note.offset);
  const key = date.toISOString().slice(0, 10);
  dates.push(key);
  for (const entryMode of ["manual", "ai"]) {
    const current = await request(`/api/checkins/${key}?mode=${entryMode}`);
    if (current.status === 200) continue;
    if (current.status !== 404) checked(current);
    checked(await request(`/api/checkins/${key}`, "PUT", {
      entryMode, attention: note.attention, summary: note.summary, inspiration: note.inspiration,
      sourceUrl: "", imagePath: null, imageName: "", version: null,
    }));
  }
}
await writeFile(`${directory}/demo.json`, JSON.stringify({ origin, today, dates, sourceUrl: "https://www.anthropic.com/engineering/building-effective-agents", question: "如何从工具增强的模型，走向可控、可评估的 Agent 系统？" }, null, 2));
console.log(`本地演示账号已准备；凭证保存在 ${accountFile}（不提交 Git）。`);
console.log(`同主题记录：${dates.join("、")}；重复运行会保留已有编辑。`);
