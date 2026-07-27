"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { postAuth } from "./auth-card";

type FormError = { message: string; field?: string };

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await postAuth<Record<string, never>>("/api/auth/login", { email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onLoggedIn();
    } catch {
      setError({ message: "请求未能完成，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label className="auth-field"><span>邮箱</span><input aria-describedby={error?.field === "email" ? "login-email-error" : undefined} aria-invalid={error?.field === "email" || undefined} autoComplete="username" autoFocus onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
      <label className="auth-field"><span>密码</span><input aria-describedby={error?.field === "password" ? "login-password-error" : undefined} aria-invalid={error?.field === "password" || undefined} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
      {error ? <p className="login-error" id={error.field ? `login-${error.field}-error` : undefined} role="alert">{error.message}</p> : null}
      <div className="auth-actions">
        <button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "正在登录…" : "登录"}</button>
        <Link href="/recover">忘记密码？</Link>
      </div>
      <p className="auth-switch">还没有学习身份？ <Link href="/register">注册</Link></p>
    </form>
  );
}
