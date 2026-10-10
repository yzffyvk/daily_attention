export function sourceDownloadUrl(sourceUrl: string) {
  const url = new URL(sourceUrl);
  const file = /^\/([\w.-]+)\/([\w.-]+)\/blob\/(.+\.(?:md|markdown|txt))$/iu.exec(url.pathname);
  if (url.protocol === "https:" && url.hostname === "github.com"
    && !url.port && !url.username && !url.password && file) {
    // The gateway still resolves, validates and pins every destination/redirect.
    // Keep the user's original URL on the task; only the download endpoint changes.
    return `https://raw.githubusercontent.com/${file[1]}/${file[2]}/${file[3]}`;
  }
  return sourceUrl;
}
