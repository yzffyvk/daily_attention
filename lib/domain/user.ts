import { z } from "zod";

export function normalizeLoginName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

const normalizedNameSchema = z
  .string()
  .transform(normalizeLoginName)
  .pipe(
    z
      .string()
      .min(1, "名称需要填写 1-20 个字符")
      .max(20, "名称需要填写 1-20 个字符")
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "名称不能包含控制字符"),
  );

const passwordSchema = z.string().min(8, "密码至少 8 个字符").max(72, "密码最多 72 个字符");
const recoveryCodeSchema = z
  .string()
  .transform((value) => value.replace(/-/g, "").toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u, "恢复码格式不正确"));

export const registerInputSchema = z.object({
  name: normalizedNameSchema,
  password: passwordSchema,
  avatarKey: z.number().int().min(1).max(5),
});

export const loginInputSchema = z.object({
  name: normalizedNameSchema,
  password: z.string(),
});

export const recoverInputSchema = z.object({
  name: normalizedNameSchema,
  recoveryCode: recoveryCodeSchema,
  newPassword: passwordSchema,
});

export const profilePatchSchema = z.object({
  avatarKey: z.number().int().min(1).max(5).optional(),
  name: normalizedNameSchema.optional(),
  currentPassword: z.string().optional(),
}).superRefine((value, context) => {
  if (value.name === undefined && value.avatarKey === undefined) {
    context.addIssue({
      code: "custom",
      path: [],
      message: "请至少修改名称或头像",
    });
  }
  if (value.name !== undefined && !value.currentPassword) {
    context.addIssue({
      code: "custom",
      path: ["currentPassword"],
      message: "修改名称需要输入当前密码",
    });
  }
});
