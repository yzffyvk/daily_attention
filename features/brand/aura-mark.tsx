"use client";

/* eslint-disable @next/next/no-img-element */
import { useColorTheme } from "@/features/theme/theme";

export function AuraMark({ className = "" }: { className?: string }) {
  const theme = useColorTheme();
  return <img className={`aura-mark ${className}`} src={theme === "light" ? "/aura-icon-light.svg" : "/aura-icon.svg"} alt="" aria-hidden="true" width={64} height={64} />;
}
