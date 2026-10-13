import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEATURES, featureKind, filamentGrams, formatDuration, parseDuration, parseGcode } from "./gcode";

// Real Kiri:Moto output: a 10 mm cube at 0.3 mm layers, sliced in headless Chromium by
// .github/workflows/vendor-kiri.yml. Its default printer writes relative E without M83.
const kiriCube = readFileSync(new URL("./fixtures/kiri-cube.gcode", import.meta.url), "utf8");

test("Kiri cube: one layer per 0.3 mm, bottom to top", () => {
  const g = parseGcode(kiriCube, { absoluteE: false });
  assert.equal(g.layers.length, 33);
  assert.ok(Math.abs(g.layers[0].z - 0.3) < 1e-6);
  assert.ok(Math.abs(g.layers[32].z - 9.9) < 1e-6);
  for (let i = 1; i < g.layers.length; i++) assert.ok(g.layers[i].z > g.layers[i - 1].z);
  assert.equal(g.layers[g.layers.length - 1].end, g.kinds.length);
});

test("Kiri cube: features come through as walls, infill, solid and brim", () => {
  const g = parseGcode(kiriCube, { absoluteE: false });
  assert.deepEqual(Object.keys(g.stats).sort(), ["brim", "infill", "solid", "walls"]);
});

test("Kiri cube: filament matches what Kiri reports, and its print time is read", () => {
  const g = parseGcode(kiriCube, { absoluteE: false });
  // Kiri's own footer: "; --- filament used: 291.62 mm ---" (net of retracts).
  assert.ok(Math.abs(g.filamentMm - 291.62) / 291.62 < 0.05, `filament ${g.filamentMm}`);
  assert.equal(g.reportedSeconds, 494);
});

test("the cube sits inside its 10 mm footprint", () => {
  const g = parseGcode(kiriCube, { absoluteE: false });
  const walls = g.layers.slice(5, 25);
  let minX = Infinity, maxX = -Infinity;
  for (const l of walls) {
    for (let s = l.start; s < l.end; s++) {
      minX = Math.min(minX, g.segs[s * 6], g.segs[s * 6 + 3]);
      maxX = Math.max(maxX, g.segs[s * 6], g.segs[s * 6 + 3]);
    }
  }
  assert.ok(maxX - minX > 9 && maxX - minX < 10.5, `width ${maxX - minX}`);
});

test("Orca-style G-code: TYPE comments, absolute E with G92 resets, reported time", () => {
  const text = [
    "; estimated printing time (normal mode) = 1h 2m 3s",
    "M82",
    "G92 E0",
    "G1 Z0.2 F600",
    ";TYPE:Outer wall",
    "G1 X10 Y0 E1 F1200",
    ";TYPE:Inner wall",
    "G1 X10 Y10 E2",
    ";TYPE:Sparse infill",
    "G1 X0 Y10 E3",
    "G92 E0",
    "G1 Z0.4",
    ";TYPE:Top surface",
    "G1 X0 Y0 E0.5",
    ";TYPE:Support interface",
    "G1 X5 Y5 E1",
  ].join("\n");
  const g = parseGcode(text);
  assert.equal(g.layers.length, 2);
  assert.equal(g.reportedSeconds, 3723);
  assert.deepEqual(Object.keys(g.stats).sort(), ["infill", "inner-wall", "outer-wall", "support", "top"]);
  assert.ok(Math.abs(g.filamentMm - 4) < 1e-9);
  // 10 mm at 1200 mm/min = 0.5 s
  assert.ok(Math.abs(g.stats["outer-wall"]!.seconds - 0.5) < 1e-9);
});

test("a purge line above the first layer folds into it", () => {
  const g = parseGcode(["M83", "G1 Z0.5", "G1 X60 Y-3 E9 ; purge", "G1 Z0.2", "G1 X10 Y10 E1", "G1 Z0.4", "G1 X20 Y10 E1"].join("\n"));
  assert.deepEqual(g.layers.map((l) => [l.z, l.end - l.start]), [[0.2, 2], [0.4, 1]]);
});

test("travel and retracts are not extrusions", () => {
  const g = parseGcode(["M83", "G1 Z0.2", "G1 X5 E-1", "G1 X10 E1", "G1 X20 Y0 E0.4"].join("\n"));
  // Only the last move extrudes along XY; the prime at X10 is an unretract with movement,
  // so it counts too. The retract at X5 does not.
  assert.equal(g.kinds.length, 2);
});

test("feature names map to kinds", () => {
  assert.equal(featureKind("Outer wall"), "outer-wall");
  assert.equal(featureKind("shells"), "walls");
  assert.equal(featureKind("sparse infill"), "infill");
  assert.equal(featureKind("Internal solid infill"), "solid");
  assert.equal(featureKind("Bridge"), "bridge");
  assert.equal(featureKind("Internal Bridge"), "bridge");
  assert.equal(featureKind("thin fill"), "gap");
  assert.equal(featureKind("Support transition"), "support");
  assert.equal(featureKind("Skirt"), "brim");
  assert.equal(featureKind("Prime tower"), "other");
  assert.equal(new Set(FEATURES.map((f) => f.kind)).size, FEATURES.length);
});

test("durations and filament weight", () => {
  assert.equal(parseDuration("2d 1h 0m 5s"), 2 * 86400 + 3600 + 5);
  assert.equal(parseDuration("soon"), null);
  assert.equal(formatDuration(40), "40 s");
  assert.equal(formatDuration(14 * 60), "14 m");
  assert.equal(formatDuration(2 * 3600 + 48 * 60), "2 h 48 m");
  // 1 m of 1.75 mm PLA (1.24 g/cm³) is about 2.98 g.
  assert.ok(Math.abs(filamentGrams(1000, 1.75, 1.24) - 2.98) < 0.01);
});
