// Drawing annotations: overall dimensions and hole callouts for the generated sheet.
// Pure and DOM-free so they can be tested in Node; drawing-render.ts draws them.
// Works on what the user sees: hidden parts are skipped and exploded parts are
// measured where they are, not where they were modelled.
import * as THREE from "three";
import type { HoleFeature, PartAnalysis } from "./types";
import type { Units } from "./units";

export interface DrawingPart {
  name: string;
  visible: boolean;
  /** Current offset of the part (explode). */
  offset: THREE.Vector3;
  /** Bounds in the part's own coordinates. */
  box: THREE.Box3;
  data: PartAnalysis | null;
}

export type ViewAxis = "x" | "y" | "z";

export interface DrawingCallout {
  featureName: string;
  partName: string;
  /** Number of identical holes the callout covers (pattern size, or 1). */
  count: number;
  lines: string[];
  /** World axis the hole runs along, used to pick the view it appears round in. */
  axis: ViewAxis | null;
  /** Hole entry centre, in world coordinates. */
  center: THREE.Vector3;
  /** Outer radius at the entry (counterbore if any), for the leader start. */
  radius: number;
}

export interface DrawingAnnotations {
  envelope: THREE.Box3;
  size: THREE.Vector3;
  dimensions: { x: string; y: string; z: string };
  callouts: DrawingCallout[];
}

export function axisOf(v: THREE.Vector3): ViewAxis | null {
  const n = v.clone().normalize();
  if (Math.abs(n.x) > 0.999) return "x";
  if (Math.abs(n.y) > 0.999) return "y";
  if (Math.abs(n.z) > 0.999) return "z";
  return null;
}

/** Callout text, e.g. ["4X Ø0.375 THRU", "⌴ Ø0.625 ↧ 0.125"]. Units are stated in the title block. */
export function holeCalloutLines(h: HoleFeature, count: number, u: Units): string[] {
  const depth = h.thru || h.depth == null ? "THRU" : `↧ ${u.len(h.depth, false)}`;
  const lines = [`${count > 1 ? `${count}X ` : ""}Ø${u.len(2 * h.radius, false)} ${depth}`];
  if (h.cbore) lines.push(`⌴ Ø${u.len(2 * h.cbore.radius, false)} ↧ ${u.len(h.cbore.depth, false)}`);
  return lines;
}

export function drawingAnnotations(parts: readonly DrawingPart[], units: Units, maxCallouts = 6): DrawingAnnotations {
  const visible = parts.filter((p) => p.visible);
  const envelope = new THREE.Box3();
  for (const p of visible) envelope.union(p.box.clone().translate(p.offset));
  const size = envelope.isEmpty() ? new THREE.Vector3() : envelope.getSize(new THREE.Vector3());

  // One callout per hole pattern, and one per hole that isn't in a pattern.
  const callouts: DrawingCallout[] = [];
  for (const p of visible) {
    const seen = new Set<string>();
    for (const f of p.data?.features ?? []) {
      if (f.kind !== "hole") continue;
      if (f.pattern) {
        if (seen.has(f.pattern)) continue;
        seen.add(f.pattern);
      }
      const count = f.pattern ? f.patternCount ?? 1 : 1;
      callouts.push({
        featureName: f.pattern ?? f.name,
        partName: p.name,
        count,
        lines: holeCalloutLines(f, count, units),
        axis: axisOf(f.axis),
        center: f.entry.clone().add(p.offset),
        radius: f.cbore ? f.cbore.radius : f.radius,
      });
    }
  }
  // Patterns first: they carry the most information per leader.
  callouts.sort((a, b) => b.count - a.count || a.partName.localeCompare(b.partName) || a.featureName.localeCompare(b.featureName));

  return {
    envelope,
    size,
    dimensions: { x: units.len(size.x, false), y: units.len(size.y, false), z: units.len(size.z, false) },
    callouts: callouts.slice(0, maxCallouts),
  };
}
