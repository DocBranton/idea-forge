import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSampleBracket } from "../cad/engine/sample";
import { meshBounds, modelToStl, triangleCount } from "./stl";
import { DEFAULT_SETTINGS, PRINTERS, changedKeys, fitProblems, kiriDevice, kiriProcess, matchingPreset, printer } from "./profiles";

test("the sample bracket becomes a well-formed binary STL in millimetres", () => {
  const m = buildSampleBracket();
  const buf = modelToStl(m);
  const view = new DataView(buf);
  const n = view.getUint32(80, true);
  assert.equal(n, triangleCount(m.meshes));
  assert.equal(buf.byteLength, 84 + n * 50);
  // Every vertex lies inside the model's bounds, which are in mm (the sample is in inches).
  const b = meshBounds(m)!;
  const width = b.max[0] - b.min[0];
  assert.ok(Math.abs(width - 3.75 * 25.4) < 0.01, `width ${width}`);
  for (let t = 0; t < n; t += Math.max(1, Math.floor(n / 50))) {
    const o = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(o + v * 12, true);
      assert.ok(x >= b.min[0] - 1e-3 && x <= b.max[0] + 1e-3);
    }
  }
});

test("every printer has a Kiri device with a bed", () => {
  assert.ok(PRINTERS.length >= 6);
  for (const p of PRINTERS) {
    assert.ok(p.bed.w > 0 && p.bed.d > 0 && p.bed.h > 0, p.id);
    assert.equal(kiriDevice(p.id).deviceName, p.name);
  }
  // Copies, so a slice can't change the shared profile.
  const d = kiriDevice("prusa-mk3s");
  d.bedWidth = 1;
  assert.equal(printer("prusa-mk3s").bed.w, 250);
});

test("settings map onto Kiri's process options", () => {
  const p = kiriProcess({ ...DEFAULT_SETTINGS, infillDensity: 35, infillPattern: "honeycomb", supports: true, brim: true, material: "petg" });
  assert.equal(p.sliceFillSparse, 0.35);
  assert.equal(p.sliceFillType, "hex");
  assert.equal(p.sliceSupportType, "automatic");
  assert.equal(p.outputBrimCount, 5);
  assert.equal(p.outputTemp, 240);
  assert.equal(kiriProcess({ ...DEFAULT_SETTINGS, brim: false }).outputBrimCount, 0);
  assert.equal(kiriProcess({ ...DEFAULT_SETTINGS, infillDensity: 0 }).sliceFillType, "none");
});

test("presets and changed markers", () => {
  assert.equal(matchingPreset(DEFAULT_SETTINGS)?.id, "0.20");
  assert.equal(changedKeys(DEFAULT_SETTINGS).size, 0);
  assert.deepEqual([...changedKeys({ ...DEFAULT_SETTINGS, infillDensity: 40 })], ["infillDensity"]);
  assert.equal(matchingPreset({ ...DEFAULT_SETTINGS, layerHeight: 0.15 }), null);
});

test("parts that don't fit are flagged", () => {
  const mini = printer("prusa-mini");
  assert.deepEqual(fitProblems([100, 100, 50], mini), []);
  assert.equal(fitProblems([200, 100, 50], mini).length, 1);
  assert.equal(fitProblems([200, 100, 500], mini).length, 2);
  assert.deepEqual(fitProblems(null, mini), ["There is no part to slice."]);
});
