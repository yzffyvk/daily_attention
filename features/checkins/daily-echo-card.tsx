import type { Ref } from "react";
import { getDailyEcho } from "./daily-echo";

export function DailyEchoCard({ date, svgRef }: { date: string; svgRef?: Ref<SVGSVGElement> }) {
  const echo = getDailyEcho(date);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 960" width="720" height="960" ref={svgRef}
      className="daily-echo-card" role="img" aria-label={`${date.replaceAll("-", ".")} 打卡成功。今日口令：${echo.phrase}。${echo.lines.join("")}`}>
      <rect width="720" height="960" fill="#fff8e8" />
      <image href="/visuals/daily-echo-garden.png" width="720" height="960" preserveAspectRatio="xMidYMid slice" />
      <g fill="#725337" fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
        <text x="54" y="68" fontSize="20" letterSpacing="5">今日回响</text>
        <text x="666" y="68" textAnchor="end" fontSize="13" letterSpacing="3">DAILY ECHO</text>
        <path d="M54 91H666" stroke="#725337" strokeOpacity=".2" />
        <text x="54" y="146" fontSize="16" letterSpacing="3">今日口令</text>
        <text x="54" y="202" fontSize="39" fontWeight="600" letterSpacing="3">{echo.number} · {echo.phrase}</text>
      </g>
      <g fill="#50351f" textAnchor="middle" fontFamily="'Songti SC', 'STSong', 'Noto Serif CJK SC', 'SimSun', serif" fontWeight="600" fontSize="34" letterSpacing="2">
        {echo.lines.map((line, index) => <text key={line} x="360" y={310 + index * 65}>{line}</text>)}
      </g>
      <g fill="#725337" fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
        <path d="M54 858H666" stroke="#725337" strokeOpacity=".2" />
        <text x="54" y="899" fontSize="21" fontWeight="600" letterSpacing="1">知序 <tspan fontFamily="Georgia, serif" fontStyle="italic" fontSize="25">Aura</tspan></text>
        <text x="666" y="896" textAnchor="end" fontSize="17" letterSpacing="1">{date.replaceAll("-", ".")} · 打卡成功</text>
        <text x="54" y="928" fontSize="13" letterSpacing="2">让每一次学习，都有回响。</text>
      </g>
    </svg>
  );
}
