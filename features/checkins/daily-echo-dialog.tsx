"use client";

/* eslint-disable @next/next/no-img-element */
import { Check, Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./dirty-switch-dialog";
import { DailyEchoCard } from "./daily-echo-card";
import { createDailyEchoPng, downloadDailyEcho } from "./daily-echo-export";
import { getDailyEcho } from "./daily-echo";
import "./daily-echo.css";

export function DailyEchoDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const exportRef = useRef<AbortController | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const echo = getDailyEcho(date);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Keep background controls out of keyboard and screen-reader navigation.
    const background = Array.from(document.body.children).filter(element => element instanceof HTMLElement && !element.contains(dialogRef.current)) as HTMLElement[];
    const priorInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    return () => {
      document.body.style.overflow = overflow;
      background.forEach((element, index) => { element.inert = priorInert[index]; });
      exportRef.current?.abort();
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, []);
  useDialogFocus({ dialogRef, initialFocusRef: closeRef, onClose });

  async function saveImage() {
    if (exportRef.current || !svgRef.current) return;
    if (imageUrlRef.current) { downloadDailyEcho(imageUrlRef.current, date); return; }
    const controller = new AbortController();
    exportRef.current = controller;
    setSaving(true);
    setError("");
    try {
      const blob = await createDailyEchoPng(svgRef.current, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      imageUrlRef.current = url;
      setImageUrl(url);
      downloadDailyEcho(url, date);
    } catch {
      if (!controller.signal.aborted) setError("图片暂时未生成，请重试保存。");
    } finally {
      if (!controller.signal.aborted) { exportRef.current = null; setSaving(false); }
    }
  }

  return createPortal(
    <div className="daily-echo-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="daily-echo-title" aria-describedby="daily-echo-intro" className="daily-echo-dialog" ref={dialogRef}>
        <div className="daily-echo-heading">
          <div><span className="daily-echo-success"><Check size={13} aria-hidden="true" />打卡成功</span><h2 id="daily-echo-title">今日回响</h2></div>
          <button className="daily-echo-close" type="button" aria-label="关闭纪念卡" onClick={onClose} ref={closeRef}><X size={20} aria-hidden="true" /></button>
        </div>
        <p id="daily-echo-intro">今天的认真，值得被好好收藏。</p>
        <div className="daily-echo-paper">
          <div hidden={Boolean(imageUrl)}><DailyEchoCard date={date} svgRef={svgRef} /></div>
          {imageUrl ? <img className="daily-echo-card" src={imageUrl} alt={`${date.replaceAll("-", ".")} 打卡成功。今日口令：${echo.phrase}。${echo.lines.join("")}`} width={1440} height={1920} /> : null}
        </div>
        <p className={`daily-echo-hint${error ? " daily-echo-error" : ""}`} role={error ? "alert" : "status"}>
          {error || (imageUrl ? "已发起下载，手机上也可长按卡片保存。" : "保存一张，留给以后的自己。")}
        </p>
        <div className="daily-echo-actions">
          <button className="daily-echo-save" type="button" disabled={saving} onClick={() => void saveImage()}>
            {saving ? <LoaderCircle className="daily-echo-spinner" size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}{saving ? "正在生成图片…" : "保存图片"}
          </button>
          <button className="daily-echo-dismiss" type="button" onClick={onClose}>收下这份鼓励</button>
        </div>
      </section>
    </div>, document.body,
  );
}
