import { describe, expect, it } from "vitest";
import { AI_CREDIT_PACKS, DAILY_FREE_AI_LIMIT, getAiCreditPack } from "@/lib/domain/billing";

describe("approved AI credit pricing", () => {
  it("offers exactly the three approved prices and counts for 90 days", () => {
    expect(DAILY_FREE_AI_LIMIT).toBe(2);
    expect(AI_CREDIT_PACKS.map(p => [p.id, p.amount, p.credits, p.validDays])).toEqual([
      ["ai_1", "0.90", 1, 90], ["ai_10", "8.90", 10, 90], ["ai_20", "16.90", 20, 90],
    ]);
  });
  it("rejects unrecognized product identifiers", () => {
    expect(() => getAiCreditPack("donation")).toThrow("PAYMENT_PRODUCT_INVALID");
    expect(getAiCreditPack("ai_10").credits).toBe(10);
  });
});
