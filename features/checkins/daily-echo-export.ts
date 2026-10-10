function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read illustration"));
    reader.readAsDataURL(blob);
  });
}

// Export the same SVG shown in the dialog, with its illustration embedded.
// No foreignObject, remote fonts, private learning notes, or screenshot service.
export async function createDailyEchoPng(svg: SVGSVGElement, signal?: AbortSignal): Promise<Blob> {
  await document.fonts?.ready;
  signal?.throwIfAborted();
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute("class");
  for (const image of copy.querySelectorAll("image")) {
    const source = image.getAttribute("href");
    if (!source) continue;
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error("Unable to load illustration");
    image.setAttribute("href", await blobDataUrl(await response.blob()));
  }
  signal?.throwIfAborted();
  const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    signal?.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 1920;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Unable to export image")), "image/png"));
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function downloadDailyEcho(url: string, date: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `知序-今日回响-${date}.png`;
  document.body.append(link);
  link.click();
  link.remove();
}
