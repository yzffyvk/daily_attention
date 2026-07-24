"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";
import { RegisterForm } from "@/features/auth/register-form";

export default function RegisterPage() {
  const router = useRouter();
  const [registered, setRegistered] = useState<{ name: string; recoveryCode: string } | null>(null);
  return <><AuthCard description="名称将用于区分每个人的打卡记录。" step="01" title="创建你的学习身份"><RegisterForm onRegistered={(result) => setRegistered({ name: result.profile.displayName, recoveryCode: result.recoveryCode })} /></AuthCard><RecoveryCodeDialog name={registered?.name} onClose={() => router.replace("/")} open={!!registered} recoveryCode={registered?.recoveryCode ?? ""} /></>;
}
