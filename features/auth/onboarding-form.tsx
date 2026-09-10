"use client";

import { LogOut } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { normalizeLoginName } from "@/lib/domain/user";
import { postAuth } from "./auth-card";
import { AvatarSelector } from "@/features/profile/avatar-selector";

type FormError = { message: string; field?: string };

export function OnboardingForm({
  onCompleted = () => window.location.assign("/"),
}: {
  onCompleted?: () => void;
}) {
  const [name, setName] = useState("");
  const [avatarKey, setAvatarKey] = useState<number | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = normalizeLoginName(name);
    if (!displayName) {
      setError({ message: "请填写名称", field: "displayName" });
      return;
    }
    if (displayName.length > 20) {
      setError({ message: "名称需要填写 1-20 个字符", field: "displayName" });
      return;
    }
    if (!avatarKey) {
      setError({ message: "请选择头像", field: "avatarKey" });
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await postAuth("/api/onboarding", { displayName, avatarKey });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCompleted();
    } catch {
      setError({ message: "请求未能完成，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function logout() {
    setError(null);
    setIsLoggingOut(true);
    const result = await postAuth("/api/auth/logout", {});
    if (result.ok) {
      window.location.assign("/login");
      return;
    }
    setError(result.error);
    setIsLoggingOut(false);
  }

  return (
    <form className="auth-form onboarding-form" onSubmit={submit} noValidate>
      <label className="auth-field">
        <span>名称</span>
        <input
          aria-describedby={error?.field === "displayName" ? "onboarding-name-error" : undefined}
          aria-invalid={error?.field === "displayName" || undefined}
          autoComplete="nickname"
          autoFocus
          maxLength={20}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：学习中的小明"
          value={name}
        />
      </label>

      <fieldset
        aria-describedby={error?.field === "avatarKey" ? "onboarding-avatar-error" : undefined}
        aria-invalid={error?.field === "avatarKey" || undefined}
        className="avatar-fieldset"
      >
        <legend>选择头像</legend>
        <AvatarSelector name="onboarding-avatar" value={avatarKey} onChange={setAvatarKey} disabled={isSubmitting || isLoggingOut} />
      </fieldset>

      {error ? (
        <p
          className="login-error"
          id={
            error.field === "displayName"
              ? "onboarding-name-error"
              : error.field === "avatarKey"
                ? "onboarding-avatar-error"
                : undefined
          }
          role="alert"
        >
          {error.message}
        </p>
      ) : null}

      <div className="onboarding-actions">
        <button
          className="primary-button"
          disabled={isSubmitting || isLoggingOut}
          type="submit"
        >
          {isSubmitting ? "正在保存…" : "进入学习空间"}
        </button>
        <button
          className="text-button onboarding-logout"
          disabled={isSubmitting || isLoggingOut}
          onClick={logout}
          type="button"
        >
          <LogOut aria-hidden="true" size={15} />
          {isLoggingOut ? "正在退出…" : "切换账号"}
        </button>
      </div>
    </form>
  );
}
