import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AvatarImage } from "@/features/profile/avatar-image";
import { avatarOptions } from "@/features/profile/avatar-catalog";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import "@/app/globals.css";
import "@/app/attention-theme.css";
import "@/app/light-theme.css";
import "./avatar-motion.css";

const actions = ["眨眼 · 星星绕行", "翻页 · 低头阅读", "眨眼 · 挥手 · 芯片微光", "困倦眨眼 · 呼吸 · 动动脚", "拼合积木 · 眨眼 · 连接微光"];

function MotionReview() {
  const [playing, setPlaying] = useState(true);
  return <main className="motion-review">
    <header className="motion-review-header">
      <div><p className="motion-review-brand">知序 AURA</p><h1>五个形象，各有小动作。</h1><p>保留熟悉的造型，让眼神、双手和随身的小物件动起来。</p></div>
      <div className="motion-review-controls"><button type="button" onClick={() => setPlaying(value => !value)}>{playing ? "查看原图" : "播放动画"}</button><ThemeToggle /></div>
    </header>
    <div className="motion-review-grid">
      {avatarOptions.map((avatar, index) => <article className="motion-review-card" key={avatar.key}>
        <span className="motion-review-number">0{avatar.key}</span>
        <div className="learning-persona-art"><AvatarImage avatarKey={avatar.key} animated={playing} width={320} height={320} /></div>
        <h2>{avatar.name}</h2><p>{avatar.description}</p><small>{actions[index]}</small>
      </article>)}
    </div>
    <footer>切换右上角主题，可以查看另一套配色。系统开启“减少动态效果”时会自动显示原图。</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<MotionReview />);
