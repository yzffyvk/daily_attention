import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("guards the cloud journal page and installs one query provider", async () => {
  const [page, layout, providers] = await Promise.all([
    readFile(new URL("../app/(app)/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/providers.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /supabase\.auth\.getClaims\(\)/);
  assert.match(page, /redirect\("\/login"\)/);
  assert.match(page, /<CheckInWorkspace/);
  assert.match(page, /initialProfile/);
  assert.match(layout, /<Providers>\{children\}<\/Providers>/);
  assert.match(providers, /new QueryClient/);
  assert.match(providers, /staleTime:\s*30_000/);
});

test("uses only Supabase formal runtime paths while preserving Sites and image bindings", async () => {
  const obsoletePaths = [
    "app/api/auth/wechat",
    "app/attention-app.tsx",
    "app/wechat-auth.ts",
    "db",
    "drizzle",
    "drizzle.config.ts",
    "examples/d1",
  ];
  const [packageJsonText, hostingText, viteConfig, worker, sitesPlugin] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../build/sites-vite-plugin.ts", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageJsonText);
  const hosting = JSON.parse(hostingText);

  assert.deepEqual(hosting, {
    project_id: "appgprj_6a61eeacc7e481919834e1f4c6bf758d",
  });
  assert.ok(packageJson.dependencies["@supabase/ssr"]);
  assert.equal(packageJson.dependencies["drizzle-orm"], undefined);
  assert.equal(packageJson.devDependencies["drizzle-kit"], undefined);
  for (const path of obsoletePaths) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), {
      code: "ENOENT",
    });
  }

  assert.doesNotMatch(viteConfig, /d1_databases|r2_buckets/);
  assert.doesNotMatch(worker, /D1Database|R2Bucket/);
  assert.doesNotMatch(sitesPlugin, /drizzle|migrations?/i);

  assert.match(viteConfig, /vinext\(\)/);
  assert.match(viteConfig, /sites\(\)/);
  assert.match(viteConfig, /cloudflare\(\{/);
  assert.match(viteConfig, /integrationBindings\(\)/);
  assert.match(viteConfig, /INTEGRATION_TEST_BINDINGS/);
  assert.match(viteConfig, /vars:\s*bindings/);
  assert.match(sitesPlugin, /resolve\(root,\s*"dist",\s*"\.openai"\)/);
  assert.match(sitesPlugin, /cp\(hostingConfig/);
  assert.match(worker, /handleImageOptimization/);
  assert.match(worker, /env\.ASSETS/);
  assert.match(worker, /env\.IMAGES/);
});

test("uses typed envelope parsing for check-ins, uploads, and profile updates", async () => {
  const client = await readFile(
    new URL("../features/checkins/api.ts", import.meta.url),
    "utf8",
  );

  assert.match(client, /class ApiError/);
  assert.match(client, /readonly status/);
  assert.match(client, /readonly code/);
  assert.match(client, /readonly requestId/);
  assert.match(client, /readonly current/);
  assert.match(client, /uploadToSignedUrl/);
  assert.match(client, /\/api\/uploads\/checkin-image/);
  assert.match(client, /\/api\/me/);
});

test("keeps the workspace modular while preserving dirty, conflict, and feedback behavior", async () => {
  const [workspace, editor, uploader, dialog, header] = await Promise.all([
    readFile(new URL("../features/checkins/checkin-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/checkins/checkin-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/checkins/image-note-uploader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/checkins/dirty-switch-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/profile/app-header.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /useMonthCheckIns/);
  assert.match(workspace, /useCheckIn/);
  assert.match(workspace, /useSaveCheckIn/);
  assert.match(workspace, /VERSION_CONFLICT|status === 409/);
  assert.match(workspace, /launchCelebration/);
  assert.match(workspace, /prefers-reduced-motion: reduce/);
  assert.match(workspace, /attention-journal-muted/);
  assert.match(editor, /form-actions/);
  assert.match(editor, /云端记录/);
  assert.match(uploader, /onDrop/);
  assert.match(uploader, /替换图片/);
  assert.match(uploader, /移除图片/);
  assert.match(dialog, /saveLabel/);
  assert.match(dialog, /discardLabel/);
  assert.match(workspace, /保存并切换/);
  assert.match(workspace, /放弃修改/);
  assert.match(header, /编辑资料/);
  assert.match(header, /currentPassword/);
});

test("defines compact responsive calendar, sticky controls, and reduced-motion fallback", async () => {
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.calendar-cell\s*\{[^}]*height:\s*6\.7rem/s);
  assert.match(styles, /\.calendar-cell small\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*-webkit-line-clamp:\s*1/);
  assert.match(styles, /\.form-actions\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.account-menu/);
  assert.match(styles, /\.light-toast/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /border-radius:\s*(1[0-9]|[2-9][0-9])px/);
});
