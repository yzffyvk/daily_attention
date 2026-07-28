"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { postAuth } from "./auth-card";

type Registered = {
  profile: { id: string; displayName: string; avatarKey: number; onboardingCompleted: boolean };
  recoveryCode: string;
};

type FormError = { message: string; field?: string };

export function RegisterForm({ onRegistered }: { onRegistered: (result: Registered) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) return setError({ message: "密码至少 8 个字符" });
    if (password !== confirmation) return setError({ message: "两次输入的密码不一致" });
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await postAuth<Registered>("/api/auth/register", { email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onRegistered(result.data);
    } catch {
      setError({ message: "请求未能完成，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="register-form auth-form" onSubmit={submit} noValidate>
      <label className="auth-field">
        <span>邮箱</span>
        <input aria-describedby={error?.field === "email" ? "register-email-error" : undefined} aria-invalid={error?.field === "email" || undefined} autoComplete="username" autoFocus onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
      </label>
      <label className="auth-field">
        <span>密码</span>
        <input aria-describedby={error?.field === "password" ? "register-password-error" : undefined} aria-invalid={error?.field === "password" || undefined} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
      </label>
      <label className="auth-field">
        <span>确认密码</span>
        <input autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} type="password" value={confirmation} />
      </label>
      {error ? <p className="login-error" id={error.field ? `register-${error.field}-error` : undefined} role="alert">{error.message}</p> : null}
      <div className="register-actions">
        <button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "正在创建…" : "创建账号"}</button>
        <Link className="secondary-button" href="/login">返回登录</Link>
      </div>
    </form>
  );
}
