"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { postAuth } from "./auth-card";

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const result = await postAuth<Record<string, never>>("/api/auth/login", { name, password });
    setIsSubmitting(false);
    if (!result.ok) return setError(result.error.message);
    onLoggedIn();
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label className="auth-field"><span>名称</span><input autoFocus autoComplete="username" maxLength={20} onChange={(event) => setName(event.target.value)} value={name} /></label>
      <label className="auth-field"><span>密码</span><input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <div className="auth-actions">
        <button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "正在登录…" : "登录"}</button>
        <Link href="/recover">忘记密码？</Link>
      </div>
      <p className="auth-switch">还没有学习身份？ <Link href="/register">注册</Link></p>
    </form>
  );
}
