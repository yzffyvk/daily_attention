"use client";

import { Moon, Sun } from "lucide-react";
import { setColorTheme, useColorTheme } from "./theme";

export function ThemeToggle() {
  const theme = useColorTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "切换为浅色" : "切换为深色";
  return <button className="theme-toggle" type="button" aria-label={label} title={label}
    onClick={() => setColorTheme(next)}>
    {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    <span>{next === "light" ? "浅色" : "深色"}</span>
  </button>;
}
