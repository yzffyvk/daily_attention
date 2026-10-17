export const DAILY_FREE_AI_LIMIT = 2;
export const AI_CREDIT_PACKS = [
  { id: "ai_1", title: "单次提炼", amount: "0.90", credits: 1, validDays: 90 },
  { id: "ai_10", title: "10 次提炼包", amount: "8.90", credits: 10, validDays: 90 },
  { id: "ai_20", title: "20 次提炼包", amount: "16.90", credits: 20, validDays: 90 },
] as const;
export type AiCreditPack = typeof AI_CREDIT_PACKS[number];
export function getAiCreditPack(id: string): AiCreditPack {
  const pack = AI_CREDIT_PACKS.find(p => p.id === id);
  if (!pack) throw new Error("PAYMENT_PRODUCT_INVALID");
  return pack;
}
export type AiCreditBalance = {
  freeLimit: number; freeRemaining: number; paidRemaining: number;
  remaining: number | null; unlimited: boolean; resetsAt: string;
  lots: { orderNo: string; remaining: number; expiresAt: string }[];
};
