// Loads the vendored Kiri:Moto engine in headless Chromium, slices a 10 mm cube and
// checks that G-code comes back. Writes the G-code to client/src/slicer/fixtures so the
// G-code parser's tests run against real Kiri output.
//
//   node kiri-smoke.mjs <repo root>
//
// Needs the `playwright` package and Chromium installed next to this script.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = process.argv[2] ?? process.cwd();
const publicDir = join(root, "client/public");
const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json" };

const PAGE = `<!doctype html><meta charset="utf-8"><title>kiri smoke</title>
<script type="module">
import { Engine } from "/vendor/kiri/lib/kiri/run/engine.js";
function cube(s) {
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  let out = "solid cube\\n";
  for (const t of f) {
    out += " facet normal 0 0 0\\n  outer loop\\n";
    for (const i of t) out += "   vertex " + v[i].join(" ") + "\\n";
    out += "  endloop\\n endfacet\\n";
  }
  return out + "endsolid cube\\n";
}
const t0 = performance.now();
try {
  const eng = new Engine({ workURL: "/vendor/kiri/lib/kiri/run/worker.js", poolURL: "/vendor/kiri/lib/kiri/run/minion.js" });
  const gcode = await eng.parse(cube(10))
    .then((e) => e.setProcess({ sliceHeight: 0.3, firstSliceHeight: 0.3, sliceShells: 2, sliceFillSparse: 0.2, sliceTopLayers: 2, sliceBottomLayers: 2 }))
    .then((e) => e.slice())
    .then((e) => e.prepare())
    .then((e) => e.export());
  window.__result = { ok: true, gcode, ms: Math.round(performance.now() - t0) };
} catch (e) {
  window.__result = { ok: false, error: String((e && e.stack) || e) };
}
</script>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path === "/" || path === "/smoke.html") {
    res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
    return;
  }
  const file = normalize(join(publicDir, path));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    console.log(`404 ${path}`);
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(4318, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
await page.goto("http://localhost:4318/smoke.html");
let result;
try {
  await page.waitForFunction(() => window.__result, null, { timeout: 180_000 });
  result = await page.evaluate(() => window.__result);
} catch (e) {
  result = { ok: false, error: `timed out: ${e.message}` };
}
await browser.close();
server.close();

for (const p of problems.slice(0, 8)) console.log(`::warning title=Kiri smoke browser message::${p.slice(0, 900)}`);
if (!result.ok || !result.gcode || result.gcode.length < 1000) {
  console.log(`::error title=Kiri smoke failed::${(result.error ?? `G-code too short (${result.gcode?.length ?? 0} bytes)`).slice(0, 3000)}`);
  process.exit(1);
}
const features = {};
for (const m of result.gcode.matchAll(/^; feature (.+)$/gm)) features[m[1]] = (features[m[1]] ?? 0) + 1;
console.log(`::notice title=Kiri smoke passed::${result.gcode.length} bytes of G-code in ${result.ms} ms; features ${JSON.stringify(features)}`);
console.log(`::notice title=Kiri G-code head::${result.gcode.split(/\r?\n/).slice(0, 40).join(" | ").slice(0, 3000)}`);

const fixtures = join(root, "client/src/slicer/fixtures");
await mkdir(fixtures, { recursive: true });
await writeFile(join(fixtures, "kiri-cube.gcode"), result.gcode.replace(/\r\n/g, "\n"));
