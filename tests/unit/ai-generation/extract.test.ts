import { describe, expect, it } from "vitest";
import { extractLearningSource } from "@/supabase/functions/_shared/ai/extract";

const longParagraph = "注意力机制通过查询、键和值计算相关性，并把重要信息聚合为新的表示。".repeat(8);

describe("learning source extraction", () => {
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
