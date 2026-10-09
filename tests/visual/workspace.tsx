// Test-only entry, served by serve.mjs, never registered as an application route.
// The browser runner intercepts all APIs. No credentials or real accounts are used.
import { createRoot } from "react-dom/client";
import { installTakeawayDemoApi } from "./daily-takeaway-demo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { AuthCard } from "@/features/auth/auth-card";
import { OnboardingForm } from "@/features/auth/onboarding-form";
import { KnowledgeConstellation } from "@/features/knowledge-narratives/knowledge-constellation";
import { NarrativeReader } from "@/features/knowledge-narratives/narrative-reader";
import { knowledgeMapFixture, knowledgeMapSourcesFixture, mapDates, sourceRecordsFixture } from "@/tests/helpers/knowledge-map-fixtures";
import "@/app/globals.css";
import "@/app/attention-theme.css";
import "@/app/knowledge-theme.css";
import "@/app/light-theme.css";
import { themeBootstrapScript } from "@/features/theme/theme-bootstrap";
import { setColorTheme } from "@/features/theme/theme";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { KnowledgeStructureView } from "@/features/checkins/knowledge-structure-view";
import { knowledgeStructureSchema } from "@/lib/domain/knowledge-structure";
import { relationSummaryFixture } from "@/tests/helpers/knowledge-structure-fixture";
import { KnowledgeSummaryView } from "@/features/checkins/knowledge-summary-view";
import { serializeQuestionSummary } from "@/lib/domain/knowledge-questions";
import { questionSummaryFixture } from "@/tests/helpers/knowledge-questions-fixture";
import "@/app/knowledge-structure.css";
import { installThemeDemoApi } from "./theme-demo-api";
import { DemoToolbar, type DemoScenario } from "./demo-toolbar";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const previewParameters = new URLSearchParams(window.location.search);
// Human-facing previews are always usable. Only automated fixture runners opt out.
const isDemo = previewParameters.get("fixture") !== "1";
// Same boot behavior as the real app; a query override is only for this fixture.
Function(themeBootstrapScript)();
const requestedTheme = previewParameters.get("theme");
if (requestedTheme === "dark" || requestedTheme === "light") {
  if (isDemo) {
    setColorTheme(requestedTheme);
    // Apply an entry-link preference once, so refresh/reset respects later toggles.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("theme");
    history.replaceState(null, "", cleanUrl);
  } else document.documentElement.dataset.theme = requestedTheme;
}
const demo = isDemo ? installThemeDemoApi() : null;
if (demo) installTakeawayDemoApi(demo.profile.id, previewParameters.get("takeaway"));
const scenario: DemoScenario = previewParameters.get("scenario") === "mixed" ? "mixed" : previewParameters.get("scenario") === "map" ? "map" : "ai";
const starCount = previewParameters.get("stars") === "14" ? 14 : 3;
const mapPreviewResult = previewParameters.get("mode") === "records" ? sourceRecordsFixture() : knowledgeMapFixture();
const readerPreview = knowledgeStructureSchema.parse(relationSummaryFixture().structure);
if (previewParameters.get("stress") === "1") {
  const original = readerPreview.nodes[0].name;
  const longName = 'A'.repeat(60);
  readerPreview.nodes[0].name = longName;
  readerPreview.readingOrder = readerPreview.readingOrder.map(name => name === original ? longName : name);
  readerPreview.relations = readerPreview.relations.map(edge => ({ ...edge, from: edge.from === original ? longName : edge.from, to: edge.to === original ? longName : edge.to }));
}
const mapPreviewSources = knowledgeMapSourcesFixture().map((source, index) => mapPreviewResult.mode === "source_records" ? {
  ...source, attention: ["手冲咖啡", "宋词阅读", "周末徒步"][index],
  summary: ["今天对比了两种研磨粗细，记录水温和萃取时间。", "读了苏轼的词，整理其中的意象与写作背景。", "沿山脊步道走了两小时，记录补水和休息的位置。"][index],
  inspiration: ["下次保持水温不变再对比。", "想进一步了解词牌。", "下次出发前检查天气与路线。"][index],
} : source);
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    {demo ? <DemoToolbar demo={demo} scenario={scenario} /> : null}
    {previewParameters.get("view") === "question-reader" ? (
      <main style={{ maxWidth: 1380, padding: 16, margin: "0 auto" }}><KnowledgeSummaryView value={(window as Window & { __auraQuestionSummary?: string }).__auraQuestionSummary ?? serializeQuestionSummary(questionSummaryFixture())} title="问题结构阅读" /></main>
    ) : previewParameters.get("view") === "structure-reader" ? (
      <main style={{ maxWidth: 1380, padding: 16, margin: "0 auto" }}><KnowledgeStructureView structure={readerPreview} title="结构阅读边界验收" /></main>
    ) : previewParameters.get("view") === "knowledge-map" ? (
      <main className="knowledge-workspace" style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(16px, 5vw, 64px) clamp(12px, 3vw, 32px)" }}>
        <ThemeToggle />
        <p className="knowledge-muted">知识串联 · 虚构学习材料示例</p>
        <nav className="narrative-citations" aria-label="示例切换" style={{ gap: 24, color: "var(--aura-gold)", marginBottom: 24 }}><a href={`?view=knowledge-map${isDemo ? "" : "&fixture=1"}`}>概念图谱</a><a href={`?view=knowledge-map&mode=records${isDemo ? "" : "&fixture=1"}`}>原始记录展示</a></nav>
        <h1>{mapPreviewResult.title}</h1>
        <NarrativeReader narrative={{ id: `preview-${mapPreviewResult.mode}`, title: mapPreviewResult.title, result: mapPreviewResult, sources: mapPreviewSources, dates: mapDates, question: "", status: "succeeded", createdAt: "2026-09-17T10:00:00Z", updatedAt: "2026-09-17T10:00:00Z", changedDates: [], error: null }} />
      </main>
    ) : previewParameters.get("view") === "constellation" ? (
      <main className="knowledge-workspace" style={{ maxWidth: 1080, margin: "0 auto", padding: "clamp(16px, 5vw, 64px) clamp(12px, 3vw, 32px)" }}>
        <KnowledgeConstellation status="generating" dates={Array.from({ length: starCount }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`)} />
      </main>
    ) : previewParameters.get("view") === "onboarding" ? (
      <AuthCard description="设置一个名称和头像，开始积累自己的知识地图。" step="02" title="完善你的学习身份">
        <OnboardingForm onCompleted={() => { document.documentElement.dataset.onboardingCompleted = "true"; }} />
      </AuthCard>
    ) : <CheckInWorkspace initialDate={demo ? scenario === "ai" ? demo.today : scenario === "map" ? demo.dates.related[2] : demo.dates.mixed[2] : "2026-09-10"} initialToday={demo?.today ?? "2026-09-10"} userId={demo?.profile.id ?? "visual-fixture"}
      initialEntryMode={demo && scenario !== "mixed" ? "ai" : "manual"}
      initialProfile={demo?.profile ?? { id: "visual-fixture", email: "visual@example.invalid", displayName: "学习者", avatarKey: 1, onboardingCompleted: true }} />
    }
  </QueryClientProvider>,
);
