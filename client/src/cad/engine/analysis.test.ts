// Engine tests. Run with: npm run test:cad
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { analyzePart, arrangement, circleFit, newCounters } from "./analysis";
import { buildSampleBracket } from "./sample";
import type { HoleFeature, MeshData, PatternFeature } from "./types";
import { Units } from "./units";

const sample = buildSampleBracket();
const byName = (n: string) => {
  const m = sample.meshes.find((x) => x.name.startsWith(n));
  if (!m) throw new Error(`missing ${n}`);
  return m;
};
const holes = (fs: { kind: string }[]) => fs.filter((f): f is HoleFeature => f.kind === "hole");

test("sample parts are closed solids with plausible volumes", () => {
  const c = newCounters();
  for (const m of sample.meshes) {
    const a = analyzePart(m, c);
    assert.ok(a.closed, `${m.name} should be closed`);
    assert.ok(a.volume > 0);
  }
  // Base plate: 3.75 x 2 x 0.375 with R0.25 corners, minus four Ø0.375 holes counterbored Ø0.625 x 0.125.
  const plate = analyzePart(byName("Base Plate"), newCounters());
  const outline = 3.75 * 2 - (4 - Math.PI) * 0.25 ** 2;
  const hole = Math.PI * 0.1875 ** 2 * 0.25 + Math.PI * 0.3125 ** 2 * 0.125;
  const expected = outline * 0.375 - 4 * hole;
  assert.ok(Math.abs(plate.volume - expected) / expected < 0.01, `volume ${plate.volume} vs ${expected}`);
});

test("recognizes the counterbored mounting hole and the lightening hole", () => {
  const a = analyzePart(byName("Upright"), newCounters());
  const [main, light] = holes(a.features);
  assert.equal(main.type, "Counterbore");
  assert.ok(main.thru);
  assert.ok(Math.abs(2 * main.radius - 0.375) < 0.002);
  assert.ok(main.cbore && Math.abs(2 * main.cbore.radius - 0.625) < 0.002);
  assert.ok(main.cbore && Math.abs(main.cbore.depth - 0.125) < 0.001);
  // Counterbore opens on the front (-Y) face; the axis points into the material.
  assert.ok(main.axis.y > 0.999);
  assert.equal(light.type, "Hole");
  assert.ok(light.thru);
  assert.ok(Math.abs(2 * light.radius - 0.75) < 0.002);
});

test("groups the base-plate holes into a rectangular pattern", () => {
  const a = analyzePart(byName("Base Plate"), newCounters());
  const hs = holes(a.features);
  assert.equal(hs.length, 4);
  assert.ok(hs.every((h) => h.type === "Counterbore" && h.thru && h.patternCount === 4));
  const p = a.features.find((f): f is PatternFeature => f.kind === "pattern");
  assert.ok(p);
  assert.equal(p.count, 4);
  assert.equal(p.arrangement, "Rectangular");
  const fillet = a.features.find((f) => f.kind === "fillet");
  assert.ok(fillet && fillet.kind === "fillet" && fillet.type === "Round" && fillet.edges === 4);
  assert.ok(Math.abs(fillet.radius - 0.25) < 0.002);
});

test("confidence comes from the fit and is deterministic", () => {
  const a1 = analyzePart(byName("Upright"), newCounters());
  const a2 = analyzePart(byName("Upright"), newCounters());
  const c1 = a1.features.map((f) => ("confidence" in f ? f.confidence : null));
  const c2 = a2.features.map((f) => ("confidence" in f ? f.confidence : null));
  assert.deepEqual(c1, c2);
  for (const f of holes(a1.features)) {
    assert.ok(f.confidence >= 95 && f.confidence <= 99);
    assert.equal(f.source, "cad_import");
    assert.match(f.evidence, /cylinder fit RMS/);
  }
});

test("finds holes on a mesh-only (STL-style) copy of the plate", () => {
  const src = byName("Base Plate");
  // Unindexed triangle soup with no B-rep faces or normals, like an STL import.
  const tc = src.index.length / 3;
  const position = new Float32Array(tc * 9);
  for (let t = 0; t < tc * 3; t++) {
    const v = src.index[t] * 3;
    position.set([src.position[v], src.position[v + 1], src.position[v + 2]], t * 3);
  }
  const soup: MeshData = { name: "plate.stl", color: null, position, normal: null, index: Uint32Array.from({ length: tc * 3 }, (_, i) => i), brepFaces: null };
  const a = analyzePart(soup, newCounters());
  assert.equal(a.faceSource, "mesh");
  const hs = holes(a.features);
  assert.equal(hs.length, 4);
  assert.ok(hs.every((h) => h.type === "Counterbore"));
});

test("pattern arrangement classification", () => {
  const z = new THREE.Vector3(0, 0, 1);
  const ring = [0, 1, 2, 3, 4, 5].map((k) => new THREE.Vector3(Math.cos((k * Math.PI) / 3) * 20, Math.sin((k * Math.PI) / 3) * 20, 0));
  assert.equal(arrangement(ring, z), "Circular");
  const row = [0, 1, 2].map((k) => new THREE.Vector3(k * 10, 5, 0));
  assert.equal(arrangement(row, z), "Linear");
});

test("circle fit recovers centre and radius", () => {
  const pts: [number, number][] = Array.from({ length: 24 }, (_, k) => [3 + 2 * Math.cos(k / 3), -1 + 2 * Math.sin(k / 3)]);
  const fit = circleFit(pts);
  assert.ok(fit);
  assert.ok(Math.abs(fit.cx - 3) < 1e-9 && Math.abs(fit.cy + 1) < 1e-9 && Math.abs(fit.r - 2) < 1e-9);
});

test("units format inches and millimetres", () => {
  const u = new Units("in", 25.4);
  assert.equal(u.len(0.375), "0.375 in");
  u.display = "mm";
  assert.equal(u.len(0.5), "12.70 mm");
  assert.equal(u.dia(0.25), "Ø12.70 mm");
  // 0.375 in is exactly 9.525 mm: always rounds up, whatever the float noise.
  assert.equal(u.dia(0.1875), "Ø9.53 mm");
  assert.equal(u.dia(0.18749999999), "Ø9.53 mm");
});

test("sample base plate stays inside its 3.750 x 2.000 outline", () => {
  const b = analyzePart(byName("Base Plate"), newCounters()).box;
  assert.ok(Math.abs(b.min.x + 1.875) < 1e-6 && Math.abs(b.max.x - 1.875) < 1e-6);
  assert.ok(Math.abs(b.min.y + 1) < 1e-6 && Math.abs(b.max.y - 1) < 1e-6);
});
