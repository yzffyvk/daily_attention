"use client";

import { useEffect, useState } from "react";
import type { AccountProfile } from "@/server/auth/ports";
import { CheckInWorkspace } from "./checkin-workspace";

type CheckInWorkspaceClientProps = {
  initialDate: string;
  initialToday: string;
  initialProfile: AccountProfile | null;
  userId: string;
};

export function CheckInWorkspaceClient(props: CheckInWorkspaceClientProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Browser query state starts loading, unlike the server's idle query state.
  if (!mounted) {
    return (
      <main className="app-page">
        <p className="client-workspace-loading" role="status">正在准备学习空间…</p>
      </main>
    );
  }

  return <CheckInWorkspace {...props} />;
}
