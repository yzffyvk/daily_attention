import { describe, expect, it } from "vitest";
import { sourceDownloadUrl } from "../../../supabase/functions/_shared/ai/source-url.ts";

describe("GitHub text source download", () => {
  it("reads the same public file from its raw URL", () => {
    expect(sourceDownloadUrl("https://github.com/bojieli/ai-agent-book/blob/main/book/chapter2.md"))
      .toBe("https://raw.githubusercontent.com/bojieli/ai-agent-book/main/book/chapter2.md");
  });
  it.each([
    "https://example.com/a.md", "https://github.com/a/b/issues/1", "https://github.com/a/b/blob/main/image.png",
    "https://github.com.evil.example/a/b/blob/main/file.md", "https://name:pass@github.com/a/b/blob/main/file.md",
  ])("preserves other URLs for the normal gateway validation: %s", url => {
    expect(sourceDownloadUrl(url)).toBe(url);
  });
});
