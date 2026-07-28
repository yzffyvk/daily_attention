"use client";

import { useState } from "react";
import { AuthCard } from "@/features/auth/auth-card";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";
import { RegisterForm } from "@/features/auth/register-form";

export default function RegisterPage() {
  const [registered, setRegistered] = useState<{ displayName: string; recoveryCode: string } | null>(null);
  return <><AuthCard description="邮箱将用于登录和恢复学习身份。" step="01" title="创建你的学习身份"><RegisterForm onRegistered={(result) => setRegistered({ displayName: result.profile.displayName, recoveryCode: result.recoveryCode })} /></AuthCard><RecoveryCodeDialog name={registered?.displayName} onClose={() => window.location.assign("/login")} open={!!registered} recoveryCode={registered?.recoveryCode ?? ""} /></>;
}
