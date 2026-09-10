"use client";

import { AuthCard } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return <AuthCard description="使用邮箱和密码，继续在知序记录你的学习。" step="01" title="登录学习空间"><LoginForm onLoggedIn={() => window.location.assign("/")} /></AuthCard>;
}
