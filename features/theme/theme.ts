"use client";

import { useSyncExternalStore } from "react";

export type ColorTheme = "dark" | "light";
export const themeStorageKey = "aura-color-theme";
const themeEvent = "aura:theme-change";

function normalizeTheme(value: string | null | undefined): ColorTheme {
  return value === "light" ? "light" : "dark";
}

function readTheme(): ColorTheme {
  return normalizeTheme(document.documentElement.dataset.theme);
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== themeStorageKey && event.key !== null) return;
    document.documentElement.dataset.theme = normalizeTheme(event.newValue);
    onChange();
  }
  window.addEventListener(themeEvent, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(themeEvent, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(themeStorageKey, theme); } catch { /* Session switching still works with blocked storage. */ }
  window.dispatchEvent(new Event(themeEvent));
}

export function useColorTheme() {
  return useSyncExternalStore(subscribe, readTheme, () => "dark" as const);
}
