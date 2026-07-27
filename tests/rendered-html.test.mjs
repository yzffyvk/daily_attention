import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("guards the cloud journal page and installs one query provider", async () => {
  const [page, layout, providers, workspaceClient] = await Promise.all([
    readFile(new URL("../app/(app)/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/providers.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/checkins/checkin-workspace-client.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /supabase\.auth\.getClaims\(\)/);
  assert.match(page, /redirect\("\/login"\)/);
  assert.match(page, /<CheckInWorkspaceClient/);
  assert.match(page, /initialProfile/);
  assert.match(layout, /<Providers>\{children\}<\/Providers>/);
  assert.match(providers, /new QueryClient/);
  assert.match(providers, /staleTime:\s*30_000/);
  assert.match(workspaceClient, /const \[mounted, setMounted\] = useState\(false\)/);
  assert.match(workspaceClient, /requestAnimationFrame\(\(\) => setMounted\(true\)\)/);
  assert.match(workspaceClient, /role="status"/);
  assert.match(workspaceClient, /<CheckInWorkspace \{\.\.\.props\} \/>/);
});

test("derives social image metadata from a trusted configured origin", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(layout, /process\.env\.APP_ORIGIN/);
  assert.match(layout, /APP_ORIGIN must use HTTPS outside local development/);
  assert.match(layout, /new URL\(\s*"\/og\.png",\s*metadataBase\s*\)/);
  assert.match(layout, /images:\s*\[\{\s*url:\s*ogImage/);
  assert.match(layout, /images:\s*\[ogImage\]/);
  assert.doesNotMatch(layout, /x-forwarded-(host|proto)/);
  assert.doesNotMatch(layout, /og-attention\.png/);
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

test("disables direct Supabase sign-up and rejects sessions without an application profile", async () => {
  const [config, page, requestContext] = await Promise.all([
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../app/(app)/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/checkins/http.ts", import.meta.url), "utf8"),
  ]);

  assert.match(config, /\[auth\][\s\S]*?enable_signup\s*=\s*false/);
  assert.match(config, /\[auth\.email\][\s\S]*?enable_signup\s*=\s*true/);
  assert.match(config, /minimum_password_length\s*=\s*8/);
  assert.match(page, /if \(error \|\| !profile\) redirect\("\/login"\)/);
  assert.match(requestContext, /\.from\("profiles"\)/);
  assert.match(requestContext, /if \(profileError \|\| !profile\) return null/);
  assert.doesNotMatch(requestContext, /console\.error\([^)]*\{\s*requestId,\s*error\s*\}/s);
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

test("renders email-oriented authentication forms", async () => {
  const [loginForm, registerForm, recoverForm, loginPage, registerPage, recoverPage] = await Promise.all([
    readFile(new URL("../features/auth/login-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/auth/register-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/auth/recover-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(auth)/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(auth)/register/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(auth)/recover/page.tsx", import.meta.url), "utf8"),
  ]);

  for (const form of [loginForm, registerForm, recoverForm]) {
    assert.match(form, /邮箱/);
    assert.match(form, /type="email"/);
    assert.match(form, /autoComplete="username"/);
    assert.doesNotMatch(form, /inputMode="numeric"/);
    assert.doesNotMatch(form, /autoComplete="tel"/);
    assert.doesNotMatch(form, /maxLength=\{11\}/);
    assert.doesNotMatch(form, /replace\(\/\\D\/gu, ""\)/);
  }
  assert.match(loginForm, /\{ email, password \}/);
  assert.match(registerForm, /\{ email, password, avatarKey \}/);
  assert.match(recoverForm, /\{ email, recoveryCode, newPassword \}/);
  assert.match(recoverForm, /result\.data\.profile\.displayName/);
  assert.match(registerForm, /<Link className="secondary-button" href="\/login">返回登录<\/Link>/);
  assert.doesNotMatch(registerForm, /name-field|setName|名称/);
  assert.match(registerPage, /result\.profile\.displayName/);
  assert.match(recoverPage, /name=\{recovered\?\.displayName\}/);
  for (const page of [loginPage, registerPage, recoverPage]) {
    assert.match(page, /邮箱/);
  }
});
