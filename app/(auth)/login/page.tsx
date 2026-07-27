"use client";

import { AuthCard } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return <AuthCard description="使用邮箱和密码继续上一次留下的 attention。" step="01" title="登录学习空间"><LoginForm onLoggedIn={() => window.location.assign("/")} /></AuthCard>;
}
