import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  profilePatchSchema,
  registerInputSchema,
  toE164Phone,
} from "@/lib/domain/user";

describe("user contracts", () => {
  it("normalizes phone numbers and converts them to E.164", () => {
    expect(normalizePhone(" 138 0013 8000 ")).toBe("13800138000");
    expect(toE164Phone("13800138000")).toBe("+8613800138000");
  });

  it("validates phone registration input without changing passwords", () => {
    expect(registerInputSchema.parse({
      phone: "138 0013 8000",
      password: "  Keep Spaces  ",
      avatarKey: 3,
    })).toEqual({
      phone: "13800138000",
      password: "  Keep Spaces  ",
      avatarKey: 3,
    });
    expect(registerInputSchema.safeParse({
      phone: "12800138000",
      password: "password123",
      avatarKey: 3,
    }).success).toBe(false);
  });

  it("allows display name patches but rejects phone patches", () => {
    expect(profilePatchSchema.safeParse({ displayName: "新的名称" }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ phone: "13900139000" }).success).toBe(false);
  });
});
