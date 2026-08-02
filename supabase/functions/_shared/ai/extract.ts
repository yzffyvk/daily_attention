import { parseHTML } from "linkedom";

const MIN_USEFUL_CHARACTERS = 200;
const MAX_MODEL_CHARACTERS = 60_000;
const firstParagraphCount = 6;
const finalParagraphCount = 3;

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
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

function orderedSegments(root: Element, title: string) {
  const paragraphs = [...root.querySelectorAll("p")]
    .map((element) => normalizedText(element.textContent))
    .filter(Boolean);
  const headings = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .map((element) => normalizedText(element.textContent))
    .filter(Boolean);

  const finalStart = Math.max(firstParagraphCount, paragraphs.length - finalParagraphCount);
  const candidates = [
    title,
    ...paragraphs.slice(0, firstParagraphCount),
    ...headings,
    ...paragraphs.slice(firstParagraphCount, finalStart),
    ...paragraphs.slice(finalStart),
  ];
  if (paragraphs.length === 0) {
    candidates.push(normalizedText(root.textContent));
  }

  const seen = new Set<string>();
  return candidates.filter((segment) => {
    if (!segment || seen.has(segment)) return false;
    seen.add(segment);
    return true;
  });
}

function boundedText(segments: string[]) {
  let text = "";
  for (const segment of segments) {
    const separator = text ? "\n\n" : "";
    const available = MAX_MODEL_CHARACTERS - text.length - separator.length;
    if (available <= 0) break;
    text += `${separator}${segment.slice(0, available)}`;
  }
  return text;
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
    const text = boundedText(orderedSegments(root, title));
    return {
      title,
      text,
      contentDigestHex: await sha256Hex(text),
    };
  } catch {
    throw new Error("CONTENT_NOT_EXTRACTABLE");
  }
}
