import { describe, expect, it } from "vitest";
import {
  loginInputSchema,
  normalizeEmail,
  profilePatchSchema,
  recoverInputSchema,
  registerInputSchema,
} from "@/lib/domain/user";

describe("user contracts", () => {
  it("normalizes email addresses", () => {
    expect(normalizeEmail(" User@Example.COM ")).toBe("user@example.com");
  });

  it("validates and normalizes registration emails without changing passwords", () => {
    expect(registerInputSchema.parse({
      email: " User@Example.COM ",
      password: "password123",
      avatarKey: 3,
    })).toEqual({
      email: "user@example.com",
      password: "password123",
      avatarKey: 3,
    });
    expect(registerInputSchema.safeParse({
      email: "not-an-email",
      password: "password123",
      avatarKey: 3,
    }).success).toBe(false);
  });

  it("normalizes login emails and rejects malformed email addresses", () => {
    expect(loginInputSchema.parse({
      email: " User@Example.COM ",
      password: "password123",
    })).toEqual({
      email: "user@example.com",
      password: "password123",
    });
    expect(loginInputSchema.safeParse({
      email: "not-an-email",
      password: "password123",
    }).success).toBe(false);
  });

  it("normalizes recovery emails and preserves the complete recovery payload", () => {
    expect(recoverInputSchema.parse({
      email: " User@Example.COM ",
      recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE",
      newPassword: "new password",
    })).toEqual({
      email: "user@example.com",
      recoveryCode: "AAAAABBBBBCCCCCDDDDDEEEEEE",
      newPassword: "new password",
    });
    expect(recoverInputSchema.safeParse({
      email: "not-an-email",
      recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE",
      newPassword: "new password",
    }).success).toBe(false);
    expect(recoverInputSchema.safeParse({
      email: "user@example.com",
      recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE",
    }).success).toBe(false);
  });

  it("allows display name patches but rejects email patches", () => {
    expect(profilePatchSchema.safeParse({ displayName: "新的名称" }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ email: "other@example.com" }).success).toBe(false);
  });
});
