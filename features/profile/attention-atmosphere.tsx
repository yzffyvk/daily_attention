"use client";

import { Circle } from "lucide-react";
import { useEffect, useRef } from "react";

/** Decorative only: no app state, network requests, or input interception. */
export function AttentionAtmosphere() {
  const atmosphereRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const atmosphere = atmosphereRef.current;
    const pointer = pointerRef.current;
    if (!atmosphere || !pointer || !window.matchMedia) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let enabled = false;

    function hide() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      pointer!.dataset.visible = "false";
      atmosphere!.style.removeProperty("--parallax-x");
      atmosphere!.style.removeProperty("--parallax-y");
    }

    function updatePreference() {
      enabled = !reduced.matches && fine.matches && !document.hidden;
      atmosphere!.dataset.motion = enabled ? "on" : "off";
      if (!enabled) hide();
    }

    function move(event: PointerEvent) {
      if (!enabled || event.pointerType === "touch") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role=dialog]")) {
        hide();
        return;
      }
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        pointer!.dataset.visible = "true";
        pointer!.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
        const x = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 14;
        const y = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 8;
        atmosphere!.style.setProperty("--parallax-x", `${x}px`);
        atmosphere!.style.setProperty("--parallax-y", `${y}px`);
      });
    }

    updatePreference();
    reduced.addEventListener("change", updatePreference);
    fine.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updatePreference);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      reduced.removeEventListener("change", updatePreference);
      fine.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updatePreference);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  return (
    <>
      <div aria-hidden="true" className="attention-atmosphere" data-motion="off" data-testid="attention-atmosphere" ref={atmosphereRef}>
        {/* A raster illustration, not UI text; the real wordmark is in AppHeader. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className="attention-eclipse" src="/visuals/attention-eclipse.png" fetchPriority="high" />
        <span className="atmosphere-caption">A<br />MORE<br />FOCUSED<br />YOU</span>
      </div>
      <div aria-hidden="true" className="attention-pointer" data-testid="attention-pointer" data-visible="false" ref={pointerRef}>
        <Circle size={34} strokeWidth={0.75} />
      </div>
    </>
  );
}
