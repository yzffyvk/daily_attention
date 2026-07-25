"use client";

import { useState } from "react";
import { AuthCard } from "@/features/auth/auth-card";
import { RecoverForm } from "@/features/auth/recover-form";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";

export default function RecoverPage() {
  const [recovered, setRecovered] = useState<{ displayName: string; recoveryCode: string } | null>(null);
  return <><AuthCard description="使用手机号、保存的恢复码和新密码恢复学习身份。" step="02" title="恢复学习身份"><RecoverForm onRecovered={setRecovered} /></AuthCard><RecoveryCodeDialog name={recovered?.displayName} onClose={() => window.location.assign("/")} open={!!recovered} recoveryCode={recovered?.recoveryCode ?? ""} /></>;
}
