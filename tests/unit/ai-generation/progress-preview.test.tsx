import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { summaryStreamPreview } from "@/lib/domain/ai-progress";
import { GenerationProgress } from "@/features/ai-generation/generation-progress";

afterEach(cleanup);
describe("readable stream previews", () => {
  it("extracts incomplete structured prose without internal IDs or quoted fake fields", () => {
    const text = '{"attention":"主题","structure":{"questions":[{"id":"q1","title":"为什么？","answer":"回答\\n下一行","evidence":"S0001"}],"nodes":[{"name":"概念","explanation":"逐步解释';
    expect(summaryStreamPreview(text)).toBe("主题\n\n为什么？\n\n回答\n下一行\n\n概念\n\n逐步解释");
    expect(summaryStreamPreview('{"warnings":["\\\"summary\\\":\\\"伪字段\\\""],"summary":"正文"}')).toBe("正文");
  });
  it("holds incomplete escapes and treats HTML as text", () => {
    expect(summaryStreamPreview('{"summary":"文字' + '\\')).toBe("文字");
    expect(summaryStreamPreview(JSON.stringify({ summary: "路径 C:" + "\\" }))).toBe("路径 C:" + "\\");
    expect(summaryStreamPreview('{"summary":"文字\\\\u4e')).toBe("文字\\u4e");
    expect(summaryStreamPreview('{"summary":"文字\\u4e')).toBe("文字");
    const preview = '<img src=x onerror="alert(1)">';
    const { container } = render(<GenerationProgress stage="generating" progress={{ phase: "writing", preview, updatedAt: new Date().toISOString() }} isLongRunning={false} error="" />);
    expect(screen.getByRole("region", { name: "正在生成的知识小结" })).toHaveTextContent(preview);
    expect(container.querySelector("img")).toBeNull();
  });
  it("keeps the current phase visible during long waits and connection interruptions", () => {
    render(<GenerationProgress stage="generating" progress={{ phase: "repairing", preview: "修正后的正文", updatedAt: new Date().toISOString() }} createdAt={new Date(Date.now() - 125000).toISOString()} isLongRunning error="网络暂时不可用" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在修正格式与原文引用");
    expect(screen.getByText(/已等待 2 分/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("正在重新连接");
    expect(screen.getByText("修正后的正文")).toBeInTheDocument();
  });
});
