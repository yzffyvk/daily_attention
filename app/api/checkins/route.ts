import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { checkIns } from "@/db/schema";
import { getWeChatUser } from "@/app/wechat-auth";

export async function GET() {
  const user = await getWeChatUser();
  if (!user) {
    return Response.json({ error: "请先登录" }, { status: 401 });
  }

  try {
    const rows = await getDb()
      .select()
      .from(checkIns)
      .where(eq(checkIns.userId, user.id))
      .orderBy(desc(checkIns.date));

    return Response.json({
      checkIns: rows.map((row) => ({
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
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "记录加载失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
