// Reproducible README screenshots from the built static export.
// Run `npm run build` first, then `npm run screenshots`. The export is served from a temp folder
// that has the same /clinic-dashboard/ prefix as GitHub Pages, so basePath works exactly as live.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, symlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const out = resolve(process.env.OUT || "docs");
const dist = resolve("out");
if (!existsSync(join(dist, "index.html"))) { console.error("No out/ folder. Run `npm run build` first."); process.exit(1); }
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "clinic-site-"));
symlinkSync(dist, join(root, "clinic-dashboard"));
const port = process.env.PORT || "5181";
const server = spawn("python3", ["-m", "http.server", port, "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
const base = `http://127.0.0.1:${port}/clinic-dashboard/`;

const browser = await chromium.launch();
const errors = [];
async function shot(name, url, { device, viewport = { width: 1440, height: 1000 }, full = false, clip, before } = {}) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  if (before) await before(page);
  await page.waitForTimeout(250);
  await (clip ? page.locator(clip) : page).screenshot({ path: `${out}/${name}.png`, fullPage: full && !clip });
  await ctx.close();
}

process.on("exit", () => server.kill());
try {
  await shot("login", "", { viewport: { width: 1280, height: 760 } });
  await shot("overview", "calendar/?as=receptionist&date=2026-11-12&tester=1", {
    viewport: { width: 1440, height: 1010 },
    before: async (p) => {
      await p.getByRole("button", { name: "Book on top of an existing visit" }).click();
      await p.getByRole("button", { name: "Open a patient's clinical notes" }).click();
    },
  });
  await shot("late-cancel", "calendar/?as=receptionist&date=2026-11-12", {
    viewport: { width: 1100, height: 1150 },
    clip: ".drawer",
    before: async (p) => {
      await p.locator(".blk.s-booked").first().click();
      await p.getByRole("button", { name: "Cancel appointment…" }).click();
      await p.getByRole("button", { name: "Confirm cancellation" }).click();
    },
  });
  await shot("notes-locked", "patients/view/?as=receptionist&id=p-011", { viewport: { width: 1200, height: 760 } });
  await shot("dentist-notes", "patients/view/?as=dentist&id=p-011", { viewport: { width: 1200, height: 860 } });
  await shot("admin-report", "reports/?as=admin", { viewport: { width: 1280, height: 900 } });
  await shot("mobile", "calendar/?as=receptionist&date=2026-11-12", { device: "iPhone 13" });
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("screenshots written to", out, "with no console errors");
