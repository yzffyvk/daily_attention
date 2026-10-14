import { ArrowUpRight } from "lucide-react";
import { getDailyEcho } from "./daily-echo";
import "./daily-echo.css";

export function DailyEchoCompanion({ date, today, onOpen }: { date: string; today: string; onOpen: () => void }) {
  const echo = getDailyEcho(date);
  return (
    <section className="daily-echo-companion" aria-label="每日回响">
      <div className="daily-echo-companion-title">
        <p>{date === today ? "今日回响" : "留给你的回响"}<span aria-hidden="true"> / </span><time dateTime={date}>{date.replaceAll("-", ".")}</time></p>
        <h2>{echo.phrase}</h2>
      </div>
      <p className="daily-echo-companion-lines">{echo.lines.map(line => <span key={line}>{line}</span>)}</p>
      <button type="button" className="daily-echo-companion-open" onClick={onOpen} aria-label="查看完整回响">查看卡片<ArrowUpRight size={16} aria-hidden="true" /></button>
    </section>
  );
}
