# Soft Mint Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved A3 soft-mint palette and artistic bilingual brand typography without changing layout, data, backend, database, or API behavior.

**Architecture:** Keep the refresh centralized in `app/layout.tsx` and `app/globals.css`. Load two display fonts as CSS variables at the root, map all approved colors through the existing semantic tokens, and use rendered-source contract tests to prevent later visual drift.

**Tech Stack:** Next.js 16, React 19, TypeScript, `next/font/google`, global CSS, Node test runner

## Global Constraints

- Use `#EDF5F1` as the page background, `#23352F` as foreground, `#3D7563` as primary mint, `#D9EEE5` as pale mint, `#BF544B` as coral, and `#E8D08C` as old-gold highlight.
- Use ZCOOL XiaoWei only for Chinese brand headings and Bodoni Moda 600 italic only for `attention`.
- Keep Geist and the existing Chinese system sans-serif stack for body, forms, labels, and metrics.
- Keep the brand title on one line and retain visible keyboard focus.
- Do not modify component structure, responsive layout, business behavior, backend, database, or API code.

---

### Task 1: Brand display fonts

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: existing `.brand-title-row h1`, `.brand-title-row h1 span`, `.login-brand h1`, and `.login-brand h1 span` selectors.
- Produces: root CSS variables `--font-brand-zh` and `--font-brand-en`.

- [ ] **Step 1: Write the failing font contract test**

Add a rendered-source test that reads `app/layout.tsx` and `app/globals.css` and asserts:

```js
assert.match(layout, /Bodoni_Moda/);
assert.match(layout, /ZCOOL_XiaoWei/);
assert.match(layout, /variable:\s*"--font-brand-zh"/);
assert.match(layout, /variable:\s*"--font-brand-en"/);
assert.match(styles, /\.brand-title-row h1,[\s\S]*?\.login-brand h1\s*\{[^}]*font-family:\s*var\(--font-brand-zh\)/s);
assert.match(styles, /\.brand-title-row h1 span,[\s\S]*?\.login-brand h1 span\s*\{[^}]*font-family:\s*var\(--font-brand-en\)/s);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test:rendered
```

Expected: the new test fails because the brand font imports and variables do not exist.

- [ ] **Step 3: Load and expose the two display fonts**

Update `app/layout.tsx` to import and configure:

```ts
const brandZh = ZCOOL_XiaoWei({
  variable: "--font-brand-zh",
  weight: "400",
  display: "swap",
  preload: false,
  fallback: ["Songti SC", "STSong", "serif"],
});

const brandEn = Bodoni_Moda({
  variable: "--font-brand-en",
  weight: "600",
  style: "italic",
  display: "swap",
  subsets: ["latin"],
  fallback: ["Georgia", "Times New Roman", "serif"],
});
```

Add both variables to the root `<body>` class list.

- [ ] **Step 4: Apply display fonts only to the shared brand title**

Add shared selector rules in `app/globals.css`:

```css
.brand-title-row h1,
.login-brand h1 {
  font-family: var(--font-brand-zh), "Songti SC", STSong, serif;
  font-weight: 400;
}

.brand-title-row h1 span,
.login-brand h1 span {
  font-family: var(--font-brand-en), Georgia, serif;
  font-style: italic;
  font-weight: 600;
}
```

Preserve existing single-line and responsive sizing rules.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test:rendered
npm run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add app/layout.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add artistic brand typography"
```

### Task 2: A3 soft-mint color system

**Files:**
- Modify: `app/globals.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: the existing semantic CSS tokens `--background`, `--foreground`, `--paper`, `--paper-soft`, `--ink-soft`, `--line`, `--line-strong`, `--green`, `--green-dark`, `--green-pale`, `--coral`, `--coral-pale`, `--yellow`, `--yellow-pale`, `--blue`, and `--shadow`.
- Produces: the approved A3 palette for every component already using those tokens.

- [ ] **Step 1: Write the failing palette contract test**

Add assertions for the final desktop token block:

```js
assert.match(styles, /--background:\s*#edf5f1;/i);
assert.match(styles, /--foreground:\s*#23352f;/i);
assert.match(styles, /--paper-soft:\s*#f5faf7;/i);
assert.match(styles, /--green:\s*#3d7563;/i);
assert.match(styles, /--green-dark:\s*#285c4b;/i);
assert.match(styles, /--green-pale:\s*#d9eee5;/i);
assert.match(styles, /--coral:\s*#bf544b;/i);
assert.match(styles, /--yellow:\s*#e8d08c;/i);
assert.match(styles, /--blue:\s*#2f6c86;/i);
```

Also assert that `.app-header.celebrating` uses `var(--yellow-pale)` instead of a hard-coded legacy color.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test:rendered
```

Expected: the palette assertions fail against the existing teal and acid-yellow values.

- [ ] **Step 3: Replace the desktop visual token block**

Set the final values in the later `:root` block:

```css
:root {
  --background: #edf5f1;
  --foreground: #23352f;
  --paper: #ffffff;
  --paper-soft: #f5faf7;
  --ink-soft: #69766f;
  --line: #d7e3dd;
  --line-strong: #b8cbc2;
  --green: #3d7563;
  --green-dark: #285c4b;
  --green-pale: #d9eee5;
  --coral: #bf544b;
  --coral-pale: #f8e8e4;
  --yellow: #e8d08c;
  --yellow-pale: #faf3db;
  --blue: #2f6c86;
  --shadow: 0 24px 70px rgba(35, 53, 47, 0.08);
}
```

Replace the legacy celebration literal with:

```css
.app-header.celebrating {
  background: var(--yellow-pale);
}
```

- [ ] **Step 4: Tune the brand title accent**

Keep `attention` coral and change its underline to old gold through the semantic variables. Ensure the underline remains behind the text and does not change title dimensions.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test:rendered
npm run lint
npm run typecheck
```

Expected: all commands pass.

Commit:

```bash
git add app/globals.css tests/rendered-html.test.mjs
git commit -m "style: apply soft mint color system"
```

### Task 3: Visual and production verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: the completed font and color tasks.
- Produces: desktop screenshot evidence and a clean production build.

- [ ] **Step 1: Inspect the live page at desktop widths**

Check the homepage at `1440x900` and the current wide viewport. Verify:

- the title remains a single line;
- Chinese and English display fonts load without clipping;
- mint surfaces, coral `attention`, and old-gold underline are visually distinct;
- form, calendar, selected date, completed state, and focus state remain readable;
- no module alignment or overlap regression appears.

- [ ] **Step 2: Inspect authentication branding**

Open `/login`, `/register`, and `/onboarding` as available and confirm the same title typography and palette are used consistently.

- [ ] **Step 3: Run final verification**

Run:

```bash
npm run test:unit
npm run test:rendered
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits with status 0.

- [ ] **Step 4: Confirm repository state**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: no unintended changes remain; the implementation commits are visible.
