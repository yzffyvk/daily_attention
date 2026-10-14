// Phrases follow the user's Starbucks references; the closing copy for 尽兴而为
// also comes from their reference. Keep the order stable for date-based recall.
const echoes = [
  ["无限可能", "还没试过的事，", "不必急着说不可以。", "给自己一个开始的机会。"],
  ["自有花期", "不必赶在谁前面，", "按自己的节奏生长。", "你的花，有自己的春天。"],
  ["心宽路阔", "暂时想不通，就放一放。", "给心留一点空地，", "也给明天留一点可能。"],
  ["步履不停", "走得慢一点，也没关系。", "累了就歇歇，", "有了力气，再接着向前。"],
  ["勇于探索", "顺着好奇，往前一步。", "不必每次都找到答案，", "新的风景，也值得遇见。"],
  ["尽兴而为", "想做的事就去做", "别等来日", "尽兴就好"],
  ["无拘无束", "暂时放下那些应该，", "听听自己真正的喜欢。", "今天，也可以为自己而过。"],
] as const;

export function getDailyEcho(date: string) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid keepsake date");
  }
  const start = Date.UTC(2026, 8, 19);
  const day = Math.floor((timestamp - start) / 86_400_000);
  const index = ((day % echoes.length) + echoes.length) % echoes.length;
  const [phrase, ...lines] = echoes[index];
  return { date, phrase, lines, number: String(index + 1).padStart(2, "0") };
}
