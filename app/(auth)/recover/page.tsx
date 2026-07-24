"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { RecoverForm } from "@/features/auth/recover-form";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";

export default function RecoverPage() {
  const router = useRouter();
  const [recovered, setRecovered] = useState<{ name: string; recoveryCode: string } | null>(null);
  return <><AuthCard description="使用保存的恢复码设置一个新密码。" step="02" title="恢复学习身份"><RecoverForm onRecovered={setRecovered} /></AuthCard><RecoveryCodeDialog name={recovered?.name} onClose={() => router.replace("/")} open={!!recovered} recoveryCode={recovered?.recoveryCode ?? ""} /></>;
}
