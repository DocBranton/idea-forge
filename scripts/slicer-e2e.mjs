// End-to-end check of the Produce stage slicer in headless Chromium, against the built
// client (client/dist) with the server's APIs stubbed:
//   1. open Produce, slice the sample part with Kiri:Moto in the browser
//   2. check the preview: legend, layer slider, totals
//   3. download the G-code and check the Printers tab
//   node slicer-e2e.mjs <repo root>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = process.argv[2] ?? process.cwd();
// Optional: a folder to save screenshots of each step into.
const shots = process.argv[3];
const shot = async (name) => shots && (await page.locator(".slc").screenshot({ path: `${shots}/${name}.png` }));
const dist = join(root, "client/dist");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const json = (code, body) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  if (path === "/api/me") return json(200, null);
  if (path === "/api/cad/status") return json(200, { store: "browser" });
  if (path.startsWith("/api/")) return json(404, { error: "not stubbed" });
  let file = normalize(join(dist, path));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    return res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    if (extname(path)) {
      console.log(`::warning title=404::${path}`);
      return res.writeHead(404).end();
    }
    file = join(dist, "index.html");
    return res.writeHead(200, { "Content-Type": "text/html" }).end(await readFile(file));
  }
});
await new Promise((r) => server.listen(4319, r));

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("dialog", (d) => d.dismiss());

const note = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/\n/g, " | ").slice(0, 3000)}`);
const fail = async (title, msg) => {
  for (const p of problems.slice(0, 8)) console.log(`::warning title=Browser message::${p.slice(0, 900)}`);
  const text = await page.locator(".slc").innerText().catch(() => "(no slicer on page)");
  console.log(`::error title=${title}::${String(msg).slice(0, 1500)} || slicer text: ${text.replace(/\n/g, " | ").slice(0, 1500)}`);
  await browser.close();
  server.close();
  process.exit(1);
};

try {
  // Phone width: the page starts at the top bar, with the sidebar off-screen as a drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:4319/");
  await page.locator(".topbar").waitFor({ timeout: 30_000 });
  const top = (await page.locator(".topbar").boundingBox())?.y ?? -1;
  const side = await page.locator(".sidebar").boundingBox();
  note("Phone layout", `top bar at y=${top}; sidebar at x=${side?.x}, width ${side?.width}`);
  if (top < 0 || top > 4) await fail("Gap above the page on phones", `top bar starts at y=${top}`);
  if (side && side.x + side.width > 1) await fail("Sidebar visible on phones", JSON.stringify(side));
  // The menu's Print Prep link opens Produce with the slicer scrolled into view.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.evaluate(() => {
    window.__trace = [];
    const t0 = performance.now();
    const tick = () => {
      const m = document.querySelector(".main");
      const p = document.getElementById("print-prep");
      window.__trace.push([Math.round(performance.now() - t0), m?.scrollTop, m?.scrollHeight, p ? Math.round(p.getBoundingClientRect().top) : null]);
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("button", { name: "Print Prep" }).click();
  await page.locator("#print-prep").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const panel = await page.locator("#print-prep").boundingBox();
  note("Print Prep link", `panel top at y=${Math.round(panel?.y ?? -1)} of 844`);
  const trace = await page.evaluate(() => window.__trace.filter((r, i, a) => i === 0 || r.slice(1).join() !== a[i - 1].slice(1).join()));
  note("Scroll trace [ms, scrollTop, scrollHeight, panelTop]", JSON.stringify(trace).slice(0, 2500));
  if (!panel || panel.y < -4 || panel.y > 200) await fail("Print Prep link did not scroll to the slicer", JSON.stringify(panel));
  await page.setViewportSize({ width: 1600, height: 1000 });

  await page.goto("http://localhost:4319/");
  await page.locator("ol.pipeline button", { hasText: "Produce" }).first().click();
  await page.locator(".slc").waitFor({ timeout: 60_000 });
  await page.locator(".slc-canvas canvas").waitFor({ timeout: 30_000 });
  note("Produce opened", await page.locator(".slc-side").innerText());
  await page.waitForTimeout(500);
  await shot("1-prepare");

  await page.getByRole("button", { name: "Slice plate" }).click();
  await page.locator(".slc-state", { hasText: "Sliced with Kiri:Moto" }).waitFor({ timeout: 240_000 });
  const legend = await page.locator(".slc-legend").innerText();
  const summary = await page.locator(".slc-sum").innerText();
  note("Kiri slice in the app", `${summary} || legend: ${legend}`);
  await page.waitForTimeout(500);
  await shot("2-preview");
  const layers = Number((/Layers\s+(\d+)/.exec(summary) ?? [])[1]);
  if (!(layers > 50)) await fail("Too few layers", summary);
  if (!/Walls|Outer wall/.test(legend) || !/Sparse infill/.test(legend)) await fail("Legend is missing features", legend);

  // Scrub the layer slider down and check the readout follows.
  const slider = page.getByLabel("Top layer", { exact: true });
  await slider.fill("10");
  const tag = await page.locator(".slc-tag.on").innerText();
  if (!tag.startsWith("11")) await fail("Layer slider did not move", tag);
  await page.waitForTimeout(300);
  await shot("3-layer-11");
  // Hide a feature from the legend.
  await page.locator(".slc-legend input[type=checkbox]").first().uncheck();
  await page.waitForTimeout(300);
  await shot("4-walls-hidden");

  // Download the Kiri G-code.
  const dl = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "Export G-code" }).click();
  const file = await dl;
  note("Download", file.suggestedFilename());
  if (!/\.gcode$/.test(file.suggestedFilename())) await fail("Download is not G-code", file.suggestedFilename());

  // Printers tab lists every printer profile.
  await page.getByRole("button", { name: "Printers" }).click();
  note("Printers tab", await page.locator(".slc-printers").innerText());
  await shot("5-printers");
} catch (e) {
  await fail("Slicer e2e failed", e.message);
}

const serious = problems.filter((p) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(p));
for (const p of serious.slice(0, 8)) console.log(`::warning title=Browser message::${p.slice(0, 900)}`);
await browser.close();
server.close();
note("Slicer e2e passed", `${serious.length} browser messages`);
