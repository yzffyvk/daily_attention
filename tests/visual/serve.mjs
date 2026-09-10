import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("./", import.meta.url)),
  publicDir: `${projectRoot}/public`,
  envDir: false,
  plugins: [react(), {
    name: "reuse-app-fonts-in-fixture",
    async transformIndexHtml() {
      // Reuse the app's existing local font cache; never fetch third-party fonts.
      const fontRoot = `${projectRoot}/.vinext/fonts`;
      const folders = (await readdir(fontRoot)).filter(name => /^geist-(?:mono-)?[a-f0-9]+$/.test(name));
      const styles = await Promise.all(folders.map(name => readFile(`${fontRoot}/${name}/style.css`, "utf8")));
      return [{ tag: "style", children: `${styles.join("\n").replaceAll("url(/", "url(/@fs/")}\n:root { --font-geist-sans: 'Geist'; --font-geist-mono: 'Geist Mono'; }` }];
    },
  }],
  resolve: { alias: { "@": projectRoot } },
  server: { host: "127.0.0.1", port: 4300, strictPort: true, fs: { allow: [projectRoot] } },
});
await server.listen();
console.log("Isolated frontend fixture: http://127.0.0.1:4300 (no backend configured)");
