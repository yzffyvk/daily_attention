import { z } from "zod";
import { normalizeLoginName } from "@/lib/domain/user";
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
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
}

export function nameRateBucket(request: Request, name: string) {
  return `${requestIp(request)}:${normalizeLoginName(name)}`;
}
