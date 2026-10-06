import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { analyzePart, newCounters } from "./analysis";
import { drawingAnnotations, type DrawingPart } from "./drawing";
import { buildSampleBracket } from "./sample";
import { Units } from "./units";

// The sample bracket as the viewer holds it: every part visible, nothing exploded.
function sampleParts(): DrawingPart[] {
  const sample = buildSampleBracket();
  const counters = newCounters();
  return sample.meshes.map((m) => {
    const data = analyzePart(m, counters);
    return { name: m.name, visible: true, offset: new THREE.Vector3(), box: data.box.clone(), data };
  });
}
const inches = () => new Units("in", 25.4);

test("overall dimensions cover every visible part", () => {
  const a = drawingAnnotations(sampleParts(), inches());
  assert.deepEqual(a.dimensions, { x: "3.750", y: "2.000", z: "2.750" });
});

test("hidden parts drop out of the envelope", () => {
  const parts = sampleParts();
  parts.filter((p) => p.name.startsWith("SHCS")).forEach((p) => (p.visible = false));
  const a = drawingAnnotations(parts, inches());
  // Without the fasteners (which reach 0.250 below the plate) the assembly is 2.500 tall.
  assert.equal(a.dimensions.z, "2.500");
});

test("exploded parts are measured where they are", () => {
  const parts = sampleParts();
  const upright = parts[0];
  upright.offset.set(0, 0, 1);
  const a = drawingAnnotations(parts, inches());
  // Upright top moves from 2.500 to 3.500; the fasteners still reach 0.250 below the plate.
  assert.equal(a.dimensions.z, "3.750");
  // The upright's hole callout moves with it.
  const main = a.callouts.find((c) => c.partName === upright.name && c.lines[0].includes("Ø0.375"));
  assert.ok(main);
  assert.ok(Math.abs(main.center.z - 3.1) < 1e-6);
});

test("one callout per pattern and per standalone hole", () => {
  const a = drawingAnnotations(sampleParts(), inches());
  const texts = a.callouts.map((c) => c.lines.join(" / "));
  assert.deepEqual(texts, [
    "4X Ø0.375 THRU / ⌴ Ø0.625 ↧ 0.125", // base plate pattern
    "Ø0.375 THRU / ⌴ Ø0.625 ↧ 0.125", // upright mounting hole
    "Ø0.750 THRU", // upright lightening hole
  ]);
  assert.equal(a.callouts[0].axis, "z");
  assert.equal(a.callouts[1].axis, "y");
});

test("callouts and dimensions follow the display unit", () => {
  const a = drawingAnnotations(sampleParts(), new Units("mm", 25.4));
  assert.equal(a.dimensions.x, "95.25");
  // Every 0.375 in hole reads the same in millimetres, including the upright's.
  assert.deepEqual(a.callouts.map((c) => c.lines.join(" / ")), [
    "4X Ø9.53 THRU / ⌴ Ø15.88 ↧ 3.18",
    "Ø9.53 THRU / ⌴ Ø15.88 ↧ 3.18",
    "Ø19.05 THRU",
  ]);
});

test("nothing visible gives an empty sheet", () => {
  const parts = sampleParts().map((p) => ({ ...p, visible: false }));
  const a = drawingAnnotations(parts, inches());
  assert.ok(a.envelope.isEmpty());
  assert.equal(a.callouts.length, 0);
});
