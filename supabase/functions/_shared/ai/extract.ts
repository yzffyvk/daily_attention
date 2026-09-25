import { parseHTML } from "linkedom";

const MIN_USEFUL_CHARACTERS = 200;
const MAX_MODEL_CHARACTERS = 60_000;

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFC")
    .replaceAll("\u00a0", " ")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?，。；：！？、])/gu, "$1")
    .replace(/([，。；：！？、])\s+/gu, "$1")
    .replace(/([,.;:!?])\s+(?=[\p{Script=Han}])/gu, "$1")
    .replace(/([（【《“‘])\s+/gu, "$1")
    .replace(/\s+([）】》”’])/gu, "$1")
    .trim();
}

function removeNoise(document: Document) {
  for (const element of document.querySelectorAll(
    "script,style,noscript,template,form,nav,footer,aside,iframe,object,embed,svg,canvas,dialog",
  )) {
    element.remove();
  }

  for (const element of document.querySelectorAll("*")) {
    const ariaHidden = element.getAttribute("aria-hidden")?.trim().toLowerCase();
    const style = element.getAttribute("style")?.replace(/\s+/gu, "").toLowerCase() ?? "";
    const role = element.getAttribute("role")?.trim().toLowerCase();
    const noiseLabel = `${element.id} ${element.className}`.toLowerCase();
    const looksLikeAdvertisement = /(^|[\s_-])(ad|ads|advert|advertisement|sponsor|promo)([\s_-]|$)/u
      .test(noiseLabel);
    if (
      element.hasAttribute("hidden")
      || ariaHidden === "true"
      || style.includes("display:none")
      || style.includes("visibility:hidden")
      || role === "navigation"
      || looksLikeAdvertisement
    ) {
      element.remove();
    }
  }
}

function documentTitle(document: Document, finalUrl: string) {
  const openGraphTitle = [...document.querySelectorAll("meta")]
    .find((element) => element.getAttribute("property")?.trim().toLowerCase() === "og:title")
    ?.getAttribute("content");
  const preferred = normalizedText(openGraphTitle)
    || normalizedText(document.querySelector("title")?.textContent)
    || normalizedText(document.title);
  if (preferred) return preferred.slice(0, 300);
  try {
    return normalizedText(new URL(finalUrl).hostname).slice(0, 300) || "公开资料";
  } catch {
    return "公开资料";
  }
}

function renderChildren(node: Node): string {
  return [...node.childNodes].map(renderNode).join("");
}

// Walk in document order: headings, lists, and tables carry the source's structure.
function renderNode(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? "").normalize("NFC").replace(/\s+/gu, " ");
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "pre") {
    const code = (element.textContent ?? "").replace(/\r\n?/gu, "\n").replace(/^\n+|\n+$/gu, "");
    const longestFence = Math.max(2, ...[...code.matchAll(/`+/gu)].map(match => match[0].length));
    const fence = "`".repeat(longestFence + 1);
    return `\n\n${fence}\n${code}\n${fence}\n\n`;
  }
  if (tag === "math" || element.classList.contains("katex")) {
    const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex) return `$${tex.trim()}$`;
    const math = tag === "math" ? element : element.querySelector("math");
    // Plain text would erase fractions, superscripts, and other MathML relationships.
    return math?.outerHTML ?? (element.textContent ?? "");
  }
  if (tag === "img") {
    const alt = normalizedText(element.getAttribute("alt"));
    return alt ? `[图片说明：${alt}]` : "";
  }
  if (tag === "ul" || tag === "ol") {
    const start = Number.parseInt(element.getAttribute("start") ?? "1", 10);
    const items = [...element.children].filter(child => child.tagName.toLowerCase() === "li");
    const lines = items.map((item, index) => {
      const prefix = tag === "ol" ? `${(Number.isFinite(start) ? start : 1) + index}. ` : "- ";
      const content = renderChildren(item).trim().replace(/\n[ \t]*\n/gu, "\n");
      return prefix + content.replace(/\n/gu, `\n${" ".repeat(prefix.length)}`);
    });
    return `\n\n${lines.join("\n")}\n\n`;
  }
  if (tag === "table") {
    // Preserve span semantics rather than flattening cells into the wrong columns.
    if (element.querySelector("[rowspan],[colspan]")) return `\n\n${element.outerHTML}\n\n`;
    const caption = normalizedText(element.querySelector("caption")?.textContent);
    const rows = [...element.querySelectorAll("tr")].map(row => {
      const cells = [...row.children].filter(cell => /^(th|td)$/iu.test(cell.tagName));
      return `| ${cells.map(cell => normalizedText(renderChildren(cell)).replaceAll("|", "\\|")).join(" | ")} |`;
    });
    return `\n\n${caption ? `${caption}\n` : ""}${rows.join("\n")}\n\n`;
  }
  const content = renderChildren(element);
  if (/^h[1-6]$/u.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${normalizedText(content)}\n\n`;
  if (tag === "p") return `\n\n${normalizedText(content)}\n\n`;
  if (/^(article|main|section|div|blockquote|dl|dt|dd|figure|figcaption)$/u.test(tag)) {
    return `\n\n${content.trim()}\n\n`;
  }
  return content;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function extractLearningSource(input: {
  html: string;
  finalUrl: string;
}): Promise<{
  title: string;
  text: string;
  contentDigestHex: string;
  truncated: boolean;
}> {
  try {
    const { document } = parseHTML(input.html);
    const title = documentTitle(document, input.finalUrl);
    removeNoise(document);
    const root = document.querySelector("article")
      ?? document.querySelector("main")
      ?? document.body;
    const usefulText = normalizedText(root?.textContent);
    if (!root || usefulText.length < MIN_USEFUL_CHARACTERS) {
      throw new Error("CONTENT_NOT_EXTRACTABLE");
    }
    const body = renderNode(root).replace(/\n[ \t]*\n(?:[ \t]*\n)+/gu, "\n\n").trim();
    const completeText = `${title}\n\n${body}`;
    const text = completeText.slice(0, MAX_MODEL_CHARACTERS);
    return {
      title,
      text,
      contentDigestHex: await sha256Hex(text),
      truncated: completeText.length > MAX_MODEL_CHARACTERS,
    };
  } catch {
    throw new Error("CONTENT_NOT_EXTRACTABLE");
  }
}
