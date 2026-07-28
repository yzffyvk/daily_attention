import { z } from "zod";

export function normalizeEmail(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

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
const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z.string()
      .min(3, "请输入正确的邮箱")
      .max(254, "邮箱最多 254 个字符")
      .email("请输入正确的邮箱"),
  );

export const registerInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict();

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

export const recoverInputSchema = z.object({
  email: emailSchema,
  recoveryCode: recoveryCodeSchema,
  newPassword: passwordSchema,
});

export const profilePatchSchema = z.object({
  avatarKey: z.number().int().min(1).max(5).optional(),
  displayName: normalizedNameSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.avatarKey === undefined && value.displayName === undefined) {
    context.addIssue({
      code: "custom",
      message: "请至少修改名称或头像",
    });
  }
});

export const onboardingInputSchema = z.object({
  displayName: normalizedNameSchema,
  avatarKey: z.number().int().min(1).max(5),
}).strict();
