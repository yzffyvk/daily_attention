import { z } from "zod";
import { normalizeEmail } from "@/lib/domain/user";
import { validationFailure } from "./response";

export const emptyInputSchema = z.object({}).strict();
export const rotateInputSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
});

export async function parseRequest<T extends z.ZodType>(
  request: Request,
  schema: T,
  requestId: string,
): Promise<{ data: z.output<T> } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: validationFailure({ message: "请求内容不正确", path: [] }, requestId) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: validationFailure(parsed.error.issues[0], requestId) };
  return { data: parsed.data };
}

export function requestIp(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  return cloudflareIp || "local";
}

export function emailRateBucket(request: Request, email: string) {
  return `${requestIp(request)}:${normalizeEmail(email)}`;
}
