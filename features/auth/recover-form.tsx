"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { postAuth } from "./auth-card";

type FormError = { message: string; field?: string };

export function RecoverForm({ onRecovered }: { onRecovered: (result: { name: string; recoveryCode: string }) => void }) {
  const [name, setName] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) return setError({ message: "两次输入的密码不一致" });
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await postAuth<{ recoveryCode: string }>("/api/auth/recover", { name, recoveryCode, newPassword });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onRecovered({ name, recoveryCode: result.data.recoveryCode });
    } catch {
      setError({ message: "请求未能完成，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label className="auth-field"><span>名称</span><input aria-describedby={error?.field === "name" ? "recover-name-error" : undefined} aria-invalid={error?.field === "name" || undefined} autoFocus autoComplete="username" maxLength={20} onChange={(event) => setName(event.target.value)} value={name} /></label>
      <label className="auth-field"><span>恢复码</span><input aria-describedby={error?.field === "recoveryCode" ? "recover-recoveryCode-error" : undefined} aria-invalid={error?.field === "recoveryCode" || undefined} autoComplete="one-time-code" onChange={(event) => setRecoveryCode(event.target.value)} placeholder="01234-56789-ABCDE-FGHJK-MNPQRS" value={recoveryCode} /></label>
      <label className="auth-field"><span>新密码</span><input aria-describedby={error?.field === "newPassword" ? "recover-newPassword-error" : undefined} aria-invalid={error?.field === "newPassword" || undefined} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} /></label>
      <label className="auth-field"><span>确认新密码</span><input autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} /></label>
      {error ? <p className="login-error" id={error.field ? `recover-${error.field}-error` : undefined} role="alert">{error.message}</p> : null}
      <div className="auth-actions"><button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "正在恢复…" : "重设密码"}</button></div>
      <p className="auth-switch">想起密码了？ <Link href="/login">返回登录</Link></p>
    </form>
  );
}
