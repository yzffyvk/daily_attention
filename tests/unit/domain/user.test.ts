import { describe, expect, it } from "vitest";
import {
  normalizeLoginName,
  recoverInputSchema,
  registerInputSchema,
} from "@/lib/domain/user";

describe("user contracts", () => {
  it("normalizes names without changing passwords", () => {
    expect(normalizeLoginName("  ＡＩ   小白  ")).toBe("AI 小白");
    const parsed = registerInputSchema.parse({
      name: "  ＡＩ   小白  ",
      password: "  Keep Spaces  ",
      avatarKey: 3,
    });
    expect(parsed.name).toBe("AI 小白");
    expect(parsed.password).toBe("  Keep Spaces  ");
  });

  it("requires the complete recovery payload", () => {
    expect(
      recoverInputSchema.safeParse({
        name: "学习者",
        recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE",
        newPassword: "new password",
      }).success,
    ).toBe(true);
  });
});
