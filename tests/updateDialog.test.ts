import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/components/admin/AdminPanelBar.tsx",
  "utf8",
);
const brandSource = readFileSync(
  "src/components/KomariBrand.tsx",
  "utf8",
);
const globalStyles = readFileSync("src/global.css", "utf8");
const appSource = readFileSync("src/main.tsx", "utf8");

test("admin branding uses the upstream Komari title on desktop and mobile", () => {
  assert.match(source, /<KomariBrand size=\{isMobile \? "sm" : "md"\} \/>/);
  assert.match(brandSource, /aria-label="Komari"/);
  assert.match(brandSource, />\s*Komari\s*<\/span>/);
  assert.doesNotMatch(brandSource, /Lite/);
});

test("the version link is shared by the desktop and mobile sidebar", () => {
  assert.match(source, /data-testid="sidebar-version"/);
  assert.match(source, /<Github/);
  assert.match(source, /flex h-5 w-4 shrink-0 items-center justify-center/);
  assert.match(source, /className="h-4 w-4"/);
  assert.match(source, /strokeWidth=\{1\.5\}/);
  assert.match(source, /text-\[var\(--gray-12\)\]/);
  assert.match(source, /group flex min-h-10 w-full items-center gap-2 rounded-md/);
  assert.match(source, /border-l-\[4px\] border-transparent p-2/);
  assert.match(source, /hover:bg-\[var\(--accent-a3\)\]/);
  assert.match(source, /hover:text-\[var\(--accent-11\)\]/);
  assert.doesNotMatch(source, /hover:bg-\[var\(--gray-a3\)\]/);
  assert.doesNotMatch(source, />\s*v\{formatVersion\(/);
  assert.match(
    source,
    /github\.com\/nuomiiiii\/komari\/releases\/tag\/\$\{encodeURIComponent\(currentVersion\)\}/,
  );
  assert.match(source, /target="_blank"/);
  assert.doesNotMatch(source, /\{!isMobile && currentVersion/);
  assert.doesNotMatch(source, /hidden=\{isMobile\}/);
  assert.doesNotMatch(source, /data-testid="sidebar-version"[\s\S]{0,120}border-t/);
});

test("snapshot versions use the compact wrapped layout on desktop and mobile", () => {
  assert.match(source, /const snapshot = version\.match\(\/\^snapshot-/);
  assert.match(source, /text-sm font-normal leading-5/);
  assert.match(source, /<span className="block">Snapshot<\/span>/);
  assert.match(source, /whitespace-nowrap text-base font-normal leading-5/);
  assert.doesNotMatch(source, /<SidebarVersionLabel[\s\S]{0,160}isMobile=\{isMobile\}/);
});

test("mobile navigation uses a partial overlay without hiding the page", () => {
  assert.match(source, /const MOBILE_SIDEBAR_WIDTH = "clamp\(184px, 42vw, 244px\)"/);
  assert.match(source, /open:\s*\{\s*x: 0,/);
  assert.match(source, /closed:\s*\{\s*x: "-100%",/);
  assert.match(
    source,
    /width: isMobile\s*\? MOBILE_SIDEBAR_WIDTH\s*:\s*sidebarOpen\s*\? `\$\{DESKTOP_SIDEBAR_WIDTH\}px`\s*:\s*"0px"/,
  );
  assert.match(source, /willChange: isMobile \? "transform" : undefined/);
  assert.doesNotMatch(source, /open:\s*\{\s*width: isMobile/);
  assert.match(source, /data-testid="mobile-sidebar-trigger"/);
  assert.match(source, /data-testid="mobile-sidebar-close"/);
  assert.match(source, /key="mobile-sidebar-backdrop"/);
  assert.match(source, /onClick=\{\(\) => setSidebarOpen\(false\)\}/);
  assert.match(source, /backgroundColor: "var\(--accent-3\)"[\s\S]{0,100}display: "block"/);
  assert.doesNotMatch(
    source,
    /backgroundColor: "var\(--accent-3\)"[\s\S]{0,100}display: isMobile && sidebarOpen \? "none"/,
  );
});

test("admin shell owns the viewport while the mobile drawer locks only main content", () => {
  assert.match(source, /initial: "auto minmax\(0, 1fr\)"/);
  assert.match(source, /md: "auto minmax\(0, 1fr\)"/);
  assert.match(source, /height: "var\(--app-viewport-height, 100vh\)"/);
  assert.match(source, /width: "100%",\s+overflow: "hidden",\s+overscrollBehavior: "none"/);
  assert.match(source, /key="mobile-sidebar-backdrop"[\s\S]*className="[^"]*touch-none/);
  assert.match(source, /data-admin-scroll-container[\s\S]*overflowY: isMobile && sidebarOpen \? "hidden" : "auto"/);
  assert.match(source, /overflowY: "auto",\s+overflowX: "hidden",\s+overscrollBehaviorY: "contain"/);
  assert.match(globalStyles, /--app-viewport-height: 100vh/);
  assert.match(globalStyles, /@supports \(height: 100dvh\)[\s\S]*--app-viewport-height: 100dvh/);
  assert.match(appSource, /minHeight: "var\(--app-viewport-height, 100vh\)"/);
});

test("mobile navigation label is localized in every admin language", () => {
  for (const locale of ["zh_CN", "zh_TW", "en", "ja_JP", "id_ID"]) {
    const messages = JSON.parse(
      readFileSync(`src/i18n/locales/${locale}.json`, "utf8"),
    );
    assert.equal(typeof messages.navigation.open, "string");
    assert.notEqual(messages.navigation.open.trim(), "");
  }
});

test("desktop update dialog gives release notes enough space", () => {
  assert.match(source, /min\(920px, calc\(100vw - 3rem\)\)/);
  assert.match(source, /max-h-\[min\(62dvh,620px\)\] overflow-y-auto/);
});

test("update dialog keeps its title, release body, and actions separated", () => {
  assert.match(source, /<header className="border-b/);
  assert.match(source, /<div className="divide-y text-sm">/);
  assert.match(source, /<footer className="flex items-center justify-end gap-2 border-t/);
});

test("release notes render GitHub-flavored Markdown", () => {
  assert.match(source, /<ReactMarkdown/);
  assert.match(source, /remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(source, /overflow-x-auto rounded-md border/);
  assert.doesNotMatch(source, /whitespace-pre-wrap/);
});
