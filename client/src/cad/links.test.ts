import { test } from "node:test";
import assert from "node:assert/strict";
import { addLink, featureKey, featuresFor, modelKey, pruneLinks, removeLink, splitKey, type LinkMap } from "./links";

const hole = featureKey("Upright (Part001)", "Hole001");
const pattern = featureKey("Base Plate (Part002)", "Pattern001");

test("add and remove links without duplicates", () => {
  let l: LinkMap = {};
  l = addLink(l, hole, "REQ-002");
  l = addLink(l, hole, "REQ-002");
  l = addLink(l, hole, "REQ-001");
  assert.deepEqual(l[hole], ["REQ-001", "REQ-002"]);
  l = removeLink(l, hole, "REQ-001");
  assert.deepEqual(l[hole], ["REQ-002"]);
  l = removeLink(l, hole, "REQ-002");
  assert.equal(hole in l, false);
  // Removing something that isn't there returns the same object.
  assert.equal(removeLink(l, hole, "REQ-009"), l);
});

test("links are immutable updates", () => {
  const a: LinkMap = {};
  const b = addLink(a, hole, "REQ-004");
  assert.notEqual(a, b);
  assert.deepEqual(a, {});
});

test("look up the features linked to a requirement", () => {
  let l: LinkMap = {};
  l = addLink(l, pattern, "REQ-004");
  l = addLink(l, hole, "REQ-004");
  l = addLink(l, hole, "REQ-002");
  assert.deepEqual(featuresFor(l, "REQ-004"), [pattern, hole].sort());
  assert.deepEqual(featuresFor(l, "REQ-002"), [hole]);
  assert.deepEqual(featuresFor(l, "REQ-008"), []);
});

test("prune drops unknown features and requirements and reports them", () => {
  let l: LinkMap = {};
  l = addLink(l, hole, "REQ-002");
  l = addLink(l, hole, "REQ-999");
  l = addLink(l, pattern, "REQ-004");
  const r = pruneLinks(l, new Set([hole]), new Set(["REQ-002", "REQ-004"]));
  assert.deepEqual(r.links, { [hole]: ["REQ-002"] });
  assert.deepEqual(r.droppedFeatures, [pattern]);
  assert.equal(r.droppedLinks, 2);
});

test("keys split back into part and feature, even with # in a part name", () => {
  assert.deepEqual(splitKey(featureKey("Bracket #2", "Hole003")), { part: "Bracket #2", feature: "Hole003" });
  assert.equal(modelKey("a.stp", 3, 120), "a.stp|3|120");
});

test("visibleSession hides reviews and links for missing features without touching history", async () => {
  const { visibleSession, recordReview: rr, recordLink: rl, emptySession: es, featureKey: fk } = await import("./links");
  const a = fk("P", "Hole001");
  const gone = fk("P", "Hole099");
  let s = rr(es(), a, "Validated");
  s = rr(s, gone, "Rejected");
  s = rl(s, a, "REQ-002", true);
  s = rl(s, a, "REQ-OLD", true);
  s = rl(s, gone, "REQ-002", true);
  const v = visibleSession(s, new Set([a]), new Set(["REQ-002"]));
  assert.deepEqual(v.reviews, { [a]: "Validated" });
  assert.deepEqual(v.links, { [a]: ["REQ-002"] });
  assert.equal(v.history.length, s.history.length);
});
