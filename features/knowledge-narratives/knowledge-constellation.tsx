"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

// Project the letter onto a receding plane; keep the star sprites facing the viewer.
function projectLetterPoint([x, y]: readonly [number, number]): [number, number] {
  const depth = (y - 165) * 1.2;
  const perspective = 620 / (620 - depth * Math.sin(Math.PI * 58 / 180));
  const planeX = (x - 420) * 1.55 * perspective;
  const planeY = depth * Math.cos(Math.PI * 58 / 180) * perspective;
  const rotation = -Math.PI / 18;
  return [
    420 + planeX * Math.cos(rotation) - planeY * Math.sin(rotation),
    162 + planeX * Math.sin(rotation) + planeY * Math.cos(rotation),
  ];
}

const aStrokes = ([
  { from: [302, 286], to: [420, 44], count: 31 },
  { from: [420, 44], to: [538, 286], count: 31 },
  { from: [344, 199], to: [496, 199], count: 19 },
] as const).map(stroke => ({ ...stroke, from: projectLetterPoint(stroke.from), to: projectLetterPoint(stroke.to) }));
const positions = ([
  [420, 44], [302, 286], [538, 286], [344, 199], [496, 199], [420, 199],
  [391, 104], [449, 104], [324, 241], [516, 241], [366, 155], [474, 155],
  [381, 199], [459, 199],
] as const).map(projectLetterPoint);
const particles = aStrokes.flatMap((stroke, strokeIndex) => Array.from({ length: stroke.count }, (_, index) => {
  const progress = index / (stroke.count - 1);
  const seed = index + strokeIndex * 37;
  const angle = seed * 2.39996;
  const x = stroke.from[0] + (stroke.to[0] - stroke.from[0]) * progress;
  const y = stroke.from[1] + (stroke.to[1] - stroke.from[1]) * progress;
  return {
    x: x + Math.sin(seed * 7) * 2.2,
    y: y + Math.cos(seed * 5) * 2.2,
    driftX: Math.round(420 + Math.cos(angle) * (200 + seed % 5 * 33) - x),
    driftY: Math.round(168 + Math.sin(angle) * (115 + seed % 4 * 15) - y),
    delay: `${seed % 11 * .09}s`,
    duration: `${3.5 + seed % 5 * .7}s`,
    radius: seed % 6 === 0 ? 1.25 : .5 + seed % 3 * .18,
  };
}));
const backgroundStars = Array.from({ length: 38 }, (_, index) => ({
  x: 35 + index * 137 % 770,
  y: 24 + index * 83 % 300,
  radius: index % 7 === 0 ? 1.1 : .55,
}));

export function KnowledgeConstellation({ dates, status, autoFocus = false }: {
  dates: string[];
  status: "queued" | "generating";
  autoFocus?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [iteration, setIteration] = useState(0);
  const containerRef = useRef<HTMLElement>(null);
  const gradientId = useId();
  const glowId = `${gradientId}-glow`;
  const strokeId = `${gradientId}-stroke`;

  // Center once when opening a live task; polling and replay must not steal the user's scroll.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      container.focus({ preventScroll: true });
      container.scrollIntoView?.({
        block: "center", inline: "nearest",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  return <section className="knowledge-constellation" data-paused={paused} aria-label="知识星图生成中" ref={containerRef} tabIndex={-1}>
    <div className="constellation-topline">
      <span>知序 · 星图渐成</span>
      <div className="constellation-motion-controls">
        <button className="constellation-motion-toggle" type="button" aria-label="重新播放星图动效" onClick={() => { setPaused(false); setIteration(value => value + 1); }}>
          <RotateCcw size={13} aria-hidden="true" /><span>重新播放</span>
        </button>
        <button className="constellation-motion-toggle" type="button" aria-label={paused ? "播放星图动效" : "暂停星图动效"} onClick={() => setPaused(value => !value)}>
          {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          <span>{paused ? "播放动效" : "暂停动效"}</span>
        </button>
      </div>
      <span className="constellation-reduced-label">静态星图</span>
    </div>

    <div className="constellation-sky" aria-hidden="true" key={iteration}>
      <div className="constellation-nebula" />
      <svg className="constellation-canvas" viewBox="0 0 840 340" fill="none" focusable="false">
        <defs>
          <radialGradient id={glowId}>
            <stop stopColor="#fff8e8" stopOpacity=".72" />
            <stop offset=".08" stopColor="#f9e8c3" stopOpacity=".34" />
            <stop offset=".28" stopColor="#e5c798" stopOpacity=".12" />
            <stop offset=".62" stopColor="#cfa66a" stopOpacity=".035" />
            <stop offset="1" stopColor="#cfa66a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={strokeId} x1="220" y1="290" x2="640" y2="115" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a78656" stopOpacity=".15" />
            <stop offset=".35" stopColor="#d8bc88" stopOpacity=".65" />
            <stop offset=".68" stopColor="#fbf1d9" stopOpacity=".95" />
            <stop offset="1" stopColor="#c8d6e5" stopOpacity=".4" />
          </linearGradient>
        </defs>
        <g className="constellation-background">
          {backgroundStars.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.radius} fill="currentColor" opacity={.12 + index % 4 * .08} />)}
        </g>
        <g className="constellation-assembly">
        <g className="constellation-monogram">
          {aStrokes.map((stroke, index) => <g key={index}>
            <path className="constellation-letter-bloom" d={`M ${stroke.from.join(" ")} L ${stroke.to.join(" ")}`} stroke={`url(#${strokeId})`} pathLength="1" style={{ "--order": index } as CSSProperties} />
            <path className="constellation-letter-thread" d={`M ${stroke.from.join(" ")} L ${stroke.to.join(" ")}`} stroke={`url(#${strokeId})`} pathLength="1" style={{ "--order": index } as CSSProperties} />
          </g>)}
        </g>
        {particles.map((particle, index) => <g key={index} transform={`translate(${particle.x} ${particle.y})`}>
          <g className="constellation-particle-arrival" style={{ "--drift-x": `${particle.driftX}px`, "--drift-y": `${particle.driftY}px`, "--delay": particle.delay } as CSSProperties}>
            <circle className="constellation-letter-dust" r={particle.radius} fill="currentColor" style={{ "--shimmer-duration": particle.duration, "--shimmer-delay": `${index % 8 * .35}s` } as CSSProperties} />
          </g>
        </g>)}
        {positions.map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`}>
          <g className="constellation-star" style={{
            "--drift-x": `${Math.cos(index * 2.4) * 220}px`,
            "--drift-y": `${Math.sin(index * 2.4) * 120}px`,
            "--order": index,
          } as CSSProperties}>
            <g className={`constellation-starlight${index < dates.length ? " constellation-source-star" : ""}${index === 0 ? " constellation-apex-star" : ""}`} style={{ "--shimmer-duration": `${4.6 + index % 4 * .6}s`, "--shimmer-delay": `${index * .2}s` } as CSSProperties}>
              <circle className="constellation-star-glow" r={index === 0 ? 44 : 29} fill={`url(#${glowId})`} />
              <path className="constellation-star-rays" d="M0 -13 C.65 -2 1.2 -.65 12 0 C1.2 .65 .65 2 0 13 C-.65 2 -1.2 .65 -12 0 C-1.2 -.65 -.65 -2 0 -13Z" />
              <path className="constellation-star-diagonals" d="M-4 -4 L4 4 M-4 4 L4 -4" />
              <circle className="constellation-star-core" r={index === 0 ? 1.65 : 1.05} />
            </g>
          </g>
        </g>)}
        </g>
      </svg>
    </div>

    <div className="constellation-copy">
      <p className="constellation-title">点点所知，渐成星图</p>
      <div className="constellation-status" role="status" aria-live="polite" aria-atomic="true">
        <h3>{status === "queued" ? "等待生成" : "正在生成"}</h3>
        <p>{status === "queued" ? "学习的星点已就位，等待开启新的连接。" : "正在寻找知识之间的联系，编织属于你的叙事。"}</p>
      </div>
    </div>
    <div className="constellation-footer">
      <span className="constellation-source-count"><i aria-hidden="true" />来自 <strong>{dates.length}</strong> 天的学习</span>
      <p>不必停留等待，生成后会自动保存。</p>
    </div>
  </section>;
}
