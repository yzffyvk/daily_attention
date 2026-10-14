"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { getDailyEcho } from "./daily-echo";

const receiptEvent = "aura:daily-echo-received";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(receiptEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(receiptEvent, onChange);
  };
}

export function useDailyEchoReceipt(accountId: string | null | undefined, today: string) {
  // Reuse the previous presentation marker so an already received echo reappears.
  const storageKey = accountId ? `aura-daily-echo-shown:${encodeURIComponent(accountId)}` : null;
  const [sessionReceipt, setSessionReceipt] = useState<{ accountId: typeof accountId; date: string } | null>(null);
  const readReceipt = useCallback(() => {
    try {
      const date = storageKey ? window.localStorage.getItem(storageKey) : null;
      if (!date || date > today) return null;
      return getDailyEcho(date).date;
    } catch { return null; }
  }, [storageKey, today]);
  const storedDate = useSyncExternalStore(subscribe, readReceipt, () => null);
  const sessionDate = sessionReceipt?.accountId === accountId ? sessionReceipt?.date : null;
  const receivedDate = sessionDate && sessionDate <= today && (!storedDate || sessionDate > storedDate) ? sessionDate : storedDate;

  function receive(date: string) {
    if (date !== today) return;
    setSessionReceipt({ accountId, date });
    try { if (storageKey) window.localStorage.setItem(storageKey, date); } catch { /* Keep the current session usable when storage is blocked. */ }
    window.dispatchEvent(new Event(receiptEvent));
  }

  function hasReceived(date: string) {
    // A pending save may retain an older render while another tab receives it.
    return readReceipt() === date || sessionDate === date;
  }

  return { receivedDate, receive, hasReceived };
}
