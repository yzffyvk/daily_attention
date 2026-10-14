import { useId, type Ref } from "react";
import type { ColorTheme } from "@/features/theme/theme";
import { getDailyEcho } from "./daily-echo";

const palettes = {
  dark: { paper: "#090b0d", ink: "#f1f2f3", muted: "#a0a5ad", accent: "#d8bc83", halo: "#695132", line: "#2d3035" },
  light: { paper: "#fffdf8", ink: "#203449", muted: "#5c6e7d", accent: "#16538d", halo: "#c6dceb", line: "#d5dde2" },
} as const;

export function DailyEchoCard({ date, theme, svgRef }: { date: string; theme: ColorTheme; svgRef?: Ref<SVGSVGElement> }) {
  const echo = getDailyEcho(date);
  const colors = palettes[theme];
  const id = useId();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 960" width="720" height="960" ref={svgRef}
      className="daily-echo-card" data-theme={theme} role="img" aria-label={`${date.replaceAll("-", ".")} 打卡成功。今日回响：${echo.phrase}。${echo.lines.join("")}`}>
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor={colors.halo} stopOpacity=".7" />
          <stop offset=".55" stopColor={colors.halo} stopOpacity=".25" />
          <stop offset="1" stopColor={colors.paper} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-orbit`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={colors.accent} stopOpacity=".12" />
          <stop offset=".5" stopColor={colors.accent} stopOpacity=".9" />
          <stop offset="1" stopColor={colors.accent} stopOpacity=".15" />
        </linearGradient>
      </defs>
      <rect width="720" height="960" fill={colors.paper} />
      {/* Aura's eclipse becomes a quiet halo; all colors are embedded for PNG export. */}
      <ellipse cx="360" cy="720" rx="355" ry="290" fill={`url(#${id}-halo)`} />
      <circle cx="360" cy="722" r="108" fill={colors.paper} stroke={`url(#${id}-orbit)`} strokeWidth="2" />
      <ellipse cx="360" cy="722" rx="200" ry="55" fill="none" stroke={colors.accent} strokeOpacity=".18" transform="rotate(-22 360 722)" />
      <circle cx="548" cy="650" r="3" fill={colors.accent} />
      <g fill={colors.muted} fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
        <text x="54" y="68" fontSize="20" letterSpacing="5">今日回响</text>
        <text x="666" y="68" textAnchor="end" fontSize="13" letterSpacing="3">DAILY ECHO</text>
        <path d="M54 94H666" stroke={colors.line} />
        <text x="360" y="196" textAnchor="middle" fontSize="17" letterSpacing="5">送给今天的你</text>
      </g>
      <text x="360" y="302" fill={colors.accent} textAnchor="middle" fontFamily="'Songti SC', 'STSong', 'Noto Serif CJK SC', 'SimSun', serif" fontWeight="600" fontSize="72" letterSpacing="10">{echo.phrase}</text>
      <path d="M342 349H378" stroke={colors.accent} strokeOpacity=".6" />
      <g fill={colors.ink} textAnchor="middle" fontFamily="'Songti SC', 'STSong', 'Noto Serif CJK SC', 'SimSun', serif" fontSize="32" letterSpacing="2">
        {echo.lines.map((line, index) => <text key={line} x="360" y={421 + index * 60}>{line}</text>)}
      </g>
      <g fill={colors.muted} fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif">
        <path d="M54 858H666" stroke={colors.line} />
        <text x="54" y="899" fontSize="21" fill={colors.ink} fontWeight="600" letterSpacing="1">知序 <tspan fontFamily="Georgia, serif" fontStyle="italic" fontSize="25">Aura</tspan></text>
        <text x="666" y="896" textAnchor="end" fontSize="17" letterSpacing="1">{date.replaceAll("-", ".")} · 打卡成功</text>
        <text x="54" y="928" fontSize="13" letterSpacing="2">让每一次学习，都有回响。</text>
      </g>
    </svg>
  );
}
