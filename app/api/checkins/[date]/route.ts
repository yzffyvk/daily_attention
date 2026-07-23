import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getWeChatUser } from "@/app/wechat-auth";
import { getDb } from "@/db";
import { checkIns } from "@/db/schema";

type RouteContext = {
  params: Promise<{ date: string }>;
};

type CheckInPayload = {
  attention?: string;
  sourceUrl?: string;
  summary?: string;
  inspiration?: string;
  imageName?: string;
  imageDataUrl?: string;
  removeImage?: boolean;
};

type Bindings = {
  ATTENTION_IMAGES?: R2Bucket;
};

function parseImageDataUrl(value: string) {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("图片格式不正确");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > 6 * 1024 * 1024) {
    throw new Error("图片处理后仍然过大");
  }
  return { contentType: match[1], bytes };
}

async function userKey(userId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function PUT(request: Request, context: RouteContext) {
  const user = await getWeChatUser();
  if (!user) {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }

  const { date } = await context.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "日期格式不正确" }, { status: 400 });
  }

  try {
    const payload = (await request.json()) as CheckInPayload;
    const attention = payload.attention?.trim() ?? "";
    const summary = payload.summary?.trim() ?? "";
    if (!attention || !summary) {
      return Response.json(
        { error: "attention 和知识点小结不能为空" },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(checkIns)
      .where(and(eq(checkIns.userId, user.id), eq(checkIns.date, date)))
      .limit(1);

    const bucket = (env as unknown as Bindings).ATTENTION_IMAGES;
    let imageKey = existing?.imageKey ?? null;
    let imageName = existing?.imageName ?? "";

    if (payload.removeImage && imageKey) {
      await bucket?.delete(imageKey);
      imageKey = null;
      imageName = "";
    }

    if (payload.imageDataUrl) {
      if (!bucket) throw new Error("图片存储暂不可用");
      const image = parseImageDataUrl(payload.imageDataUrl);
      const nextImageKey = `users/${await userKey(user.id)}/${date}/${crypto.randomUUID()}`;
      await bucket.put(nextImageKey, image.bytes, {
        httpMetadata: { contentType: image.contentType },
      });
      if (imageKey && imageKey !== nextImageKey) {
        await bucket.delete(imageKey);
      }
      imageKey = nextImageKey;
      imageName = payload.imageName?.trim() || "图片笔记";
    }

    const updatedAt = new Date().toISOString();
    const id = existing?.id ?? crypto.randomUUID();
    const [row] = await db
      .insert(checkIns)
      .values({
        id,
        userId: user.id,
        date,
        attention,
        sourceUrl: payload.sourceUrl?.trim() ?? "",
        summary,
        inspiration: payload.inspiration?.trim() ?? "",
        imageKey,
        imageName,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [checkIns.userId, checkIns.date],
        set: {
          attention,
          sourceUrl: payload.sourceUrl?.trim() ?? "",
          summary,
          inspiration: payload.inspiration?.trim() ?? "",
          imageKey,
          imageName,
          updatedAt,
        },
      })
      .returning();

    return Response.json({
      checkIn: {
        id: row.id,
        date: row.date,
        attention: row.attention,
        sourceUrl: row.sourceUrl,
        summary: row.summary,
        inspiration: row.inspiration,
        imageName: row.imageName,
        imageUrl: row.imageKey
          ? `/api/checkins/${row.date}/image?v=${encodeURIComponent(row.updatedAt)}`
          : "",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
