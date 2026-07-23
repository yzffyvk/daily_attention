import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getWeChatUser } from "@/app/wechat-auth";
import { getDb } from "@/db";
import { checkIns } from "@/db/schema";

type RouteContext = {
  params: Promise<{ date: string }>;
};

type Bindings = {
  ATTENTION_IMAGES?: R2Bucket;
};

export async function GET(_request: Request, context: RouteContext) {
  const user = await getWeChatUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { date } = await context.params;
  const [record] = await getDb()
    .select({ imageKey: checkIns.imageKey })
    .from(checkIns)
    .where(and(eq(checkIns.userId, user.id), eq(checkIns.date, date)))
    .limit(1);

  if (!record?.imageKey) return new Response("Not found", { status: 404 });
  const bucket = (env as unknown as Bindings).ATTENTION_IMAGES;
  if (!bucket) return new Response("Storage unavailable", { status: 503 });

  const object = await bucket.get(record.imageKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
