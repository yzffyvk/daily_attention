import { describe, expect, it } from "vitest";
import { extractLearningSource } from "@/supabase/functions/_shared/ai/extract";

const longParagraph = "注意力机制通过查询、键和值计算相关性，并把重要信息聚合为新的表示。".repeat(8);

describe("learning source extraction", () => {
  it("keeps the Agent formulas under their original headings and preserves repeated explanations", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/agent",
      html: `<article><h1>Agent 入门</h1>
        <h2>最小组成</h2><p>Agent = LLM + 上下文 + 工具</p>
        <p>它们是同一系统的不同展开。</p>
        <h2>生产形态</h2><p>Agent = Model + Harness</p>
        <h3>Harness 的组成</h3><ul><li>上下文</li><li>工具</li><li>保障机制<ul><li>约束</li><li>验证</li><li>纠正</li></ul></li></ul>
        <p>它们是同一系统的不同展开。</p><p>${longParagraph}</p></article>`,
    });

    expect(extracted.text).toContain("## 最小组成\n\nAgent = LLM + 上下文 + 工具");
    expect(extracted.text).toContain("## 生产形态\n\nAgent = Model + Harness");
    expect(extracted.text).toContain("### Harness 的组成");
    expect(extracted.text.indexOf("Agent = LLM")).toBeLessThan(extracted.text.indexOf("## 生产形态"));
    expect(extracted.text).toContain("- 保障机制\n  - 约束\n  - 验证\n  - 纠正");
    expect(extracted.text.split("它们是同一系统的不同展开。")).toHaveLength(3);
  });

  it("retains table relationships, code indentation, and a single math representation", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/lesson",
      html: `<article><h2>对应关系</h2>
        <table><tr><th>组件</th><th>职责</th></tr><tr><td>Model</td><td>决策</td></tr><tr><td>Harness</td><td>运行与保障</td></tr></table>
        <pre><code>while active:\n    observe()\n    act()</code></pre>
        <p>公式：<span class="katex"><span class="katex-mathml"><math><semantics><mrow>x²</mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">duplicate-math</span></span></p>
        <p>${longParagraph}</p></article>`,
    });

    expect(extracted.text).toContain("| Model | 决策 |");
    expect(extracted.text).toContain("| Harness | 运行与保障 |");
    expect(extracted.text).toContain("while active:\n    observe()\n    act()");
    expect(extracted.text).toContain("x^2");
    expect(extracted.text).not.toContain("duplicate-math");
  });

  it("retains fractions and superscripts when MathML has no TeX annotation", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/math",
      html: `<article><p>公式：<math><mrow><mfrac><mi>a</mi><mi>b</mi></mfrac><mo>=</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></math></p><p>${longParagraph}</p></article>`,
    });
    expect(extracted.text).toContain("<mfrac><mi>a</mi><mi>b</mi></mfrac>");
    expect(extracted.text).toContain("<msup><mi>x</mi><mn>2</mn></msup>");
    expect(extracted.text).not.toContain("ab=x2");
  });

  it("preserves merged table cells instead of shifting their children into the parent column", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/agent",
      html: `<article><table><tr><th>系统</th><th>组件</th></tr><tr><td rowspan="2">Harness</td><td>上下文</td></tr><tr><td>工具</td></tr></table><p>${longParagraph}</p></article>`,
    });
    expect(extracted.text).toContain('<td rowspan="2">Harness</td>');
    expect(extracted.text).toContain("<tr><td>工具</td></tr>");
    expect(extracted.text).not.toContain("| 工具 |");
  });

  it("keeps semantic article content and removes noisy or hidden nodes", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/article",
      html: `<!doctype html><html><head>
        <meta property="og:title" content=" 注意力机制 入门 ">
        <title>fallback title</title>
        <style>.secret { display: block }</style>
        <script>script-secret</script>
      </head><body>
        <nav>navigation-secret</nav>
        <main><article>
          <h1>注意力机制入门</h1>
          <p>${longParagraph}</p>
          <p hidden>hidden-secret</p>
          <p aria-hidden="true">aria-secret</p>
          <p style="display: none">display-secret</p>
          <form>form-secret</form>
          <div class="advertisement">advert-secret</div>
        </article></main>
        <p>body-fallback-secret</p>
        <footer>footer-secret</footer>
      </body></html>`,
    });

    expect(extracted.title).toBe("注意力机制 入门");
    expect(extracted.text).toContain("注意力机制入门");
    expect(extracted.text).toContain("查询、键和值");
    for (const secret of [
      "script-secret",
      "navigation-secret",
      "hidden-secret",
      "aria-secret",
      "display-secret",
      "form-secret",
      "advert-secret",
      "body-fallback-secret",
      "footer-secret",
    ]) {
      expect(extracted.text).not.toContain(secret);
    }
  });

  it("falls back from OpenGraph title to document title and normalizes whitespace", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/lesson",
      html: `<html><head><title>  Transformer\n 课程 </title></head><body><main>
        <p>  ${longParagraph.slice(0, 120)}\n\t${longParagraph}  </p>
      </main></body></html>`,
    });

    expect(extracted.title).toBe("Transformer 课程");
    expect(extracted.text).not.toMatch(/[ \t]{2,}/u);
    expect(extracted.text).not.toContain("\t");
  });

  it("rejects fewer than 200 useful characters without exposing source HTML", async () => {
    const marker = "private-source-marker";
    const failure = await extractLearningSource({
      finalUrl: "https://example.com/short",
      html: `<article><p>${marker}</p></article>`,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("CONTENT_NOT_EXTRACTABLE");
    expect(String(failure)).not.toContain(marker);
  });

  it("caps model-bound text at 60,000 characters", async () => {
    const extracted = await extractLearningSource({
      finalUrl: "https://example.com/large",
      html: `<article><h1>Large lesson</h1><p>${"有界正文内容。".repeat(20_000)}</p></article>`,
    });

    expect(extracted.text.length).toBe(60_000);
    expect(extracted.truncated).toBe(true);
    const complete = await extractLearningSource({
      finalUrl: "https://example.com/shorter",
      html: `<article><p>${longParagraph}</p></article>`,
    });
    expect(complete.truncated).toBe(false);
  });

  it("produces a stable digest for equivalent normalized content", async () => {
    const first = await extractLearningSource({
      finalUrl: "https://example.com/a",
      html: `<html><head><title>课程标题</title></head><body><article><p>${longParagraph}</p></article></body></html>`,
    });
    const second = await extractLearningSource({
      finalUrl: "https://example.com/b",
      html: `<title> 课程标题 </title><article><p>\n${longParagraph.replaceAll("，", "， ")}\n</p></article>`,
    });

    expect(second.text).toBe(first.text);
    expect(first.contentDigestHex).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.contentDigestHex).toBe(first.contentDigestHex);
  });
});
