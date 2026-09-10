// Test-only entry, served by serve.mjs, never registered as an application route.
// The browser runner intercepts all APIs. No credentials or real accounts are used.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { AuthCard } from "@/features/auth/auth-card";
import { OnboardingForm } from "@/features/auth/onboarding-form";
import "@/app/globals.css";
import "@/app/attention-theme.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    {new URLSearchParams(window.location.search).get("view") === "onboarding" ? (
      <AuthCard description="设置一个名称和头像，开始记录你的 attention。" step="02" title="完善你的学习身份">
        <OnboardingForm onCompleted={() => { document.documentElement.dataset.onboardingCompleted = "true"; }} />
      </AuthCard>
    ) : <CheckInWorkspace initialDate="2026-09-10" initialToday="2026-09-10" userId="visual-fixture"
      initialProfile={{ id: "visual-fixture", email: "visual@example.invalid", displayName: "学习者", avatarKey: 1, onboardingCompleted: true }} />
    }
  </QueryClientProvider>,
);
