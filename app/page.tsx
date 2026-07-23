import { AttentionApp } from "./attention-app";
import { getWeChatUser } from "./wechat-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getWeChatUser();

  if (!user) {
    return (
      <main className="signin-page">
        <section className="signin-panel">
          <p className="eyebrow">YOUR DAILY ATTENTION</p>
          <h1>
            今天你<span>attention</span>了吗？
          </h1>
          <p className="hero-copy">Attention is all you need~</p>
          <p className="signin-copy">
            微信扫码登录后，你的每日学习记录会安全保存，并在不同设备间保持同步。
          </p>
          <a className="signin-button" href="/api/auth/wechat/start">
            <span className="wechat-mark" aria-hidden="true">
              微信
            </span>
            微信扫码登录
          </a>
          <p className="signin-note">使用微信开放平台授权，不会读取聊天记录。</p>
        </section>
      </main>
    );
  }

  return (
    <AttentionApp
      user={{ displayName: user.displayName, avatarUrl: user.avatarUrl }}
      signOutHref="/api/auth/wechat/logout"
    />
  );
}
