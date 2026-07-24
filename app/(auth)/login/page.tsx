"use client";

import { useRouter } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  const router = useRouter();
  return <AuthCard description="继续上一次留下的 attention。" step="01" title="登录学习空间"><LoginForm onLoggedIn={() => { router.replace("/"); router.refresh(); }} /></AuthCard>;
}
