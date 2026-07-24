"use client";

/* eslint-disable @next/next/no-img-element */
import { Check } from "lucide-react";
import { FormEvent, useState } from "react";
import { postAuth } from "./auth-card";

const avatars = [1, 2, 3, 4, 5];

type Registered = {
  profile: { id: string; displayName: string; avatarKey: number };
  recoveryCode: string;
};

type FormError = { message: string; field?: string };

export function RegisterForm({ onRegistered }: { onRegistered: (result: Registered) => void }) {
  const [name, setName] = useState("");
  const [avatarKey, setAvatarKey] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return setError({ message: "名称需要填写 1-20 个字符" });
    if (!avatarKey) return setError({ message: "请选择头像" });
    if (password.length < 8) return setError({ message: "密码至少 8 个字符" });
    if (password !== confirmation) return setError({ message: "两次输入的密码不一致" });
    setError(null);
    setIsSubmitting(true);
    const result = await postAuth<Registered>("/api/auth/register", { name, password, avatarKey });
    setIsSubmitting(false);
    if (!result.ok) return setError(result.error);
    onRegistered(result.data);
  }

  return (
    <form className="register-form auth-form" onSubmit={submit} noValidate>
      <label className="name-field">
        <span>名称</span>
        <input aria-describedby={error?.field === "name" ? "register-name-error" : undefined} aria-invalid={error?.field === "name" || undefined} autoFocus maxLength={20} onChange={(event) => setName(event.target.value)} placeholder="输入一个好记的名称" value={name} />
        <small>{Array.from(name).length}/20</small>
      </label>
      <fieldset aria-describedby={error?.field === "avatarKey" ? "register-avatarKey-error" : undefined} aria-invalid={error?.field === "avatarKey" || undefined} className="avatar-fieldset">
        <legend>选择头像</legend>
        <div className="avatar-options">
          {avatars.map((option) => (
            <label className={`avatar-option${avatarKey === option ? " selected" : ""}`} key={option}>
              <input aria-label={`头像 ${option}`} checked={avatarKey === option} name="avatar" onChange={() => setAvatarKey(option)} type="radio" value={option} />
              <img alt="" src={`/avatars/avatar-${option}.svg`} />
              {avatarKey === option ? <i aria-hidden="true"><Check size={14} strokeWidth={3} /></i> : null}
            </label>
          ))}
        </div>
      </fieldset>
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
        <button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "正在创建…" : "注册并进入"}</button>
      </div>
    </form>
  );
}
