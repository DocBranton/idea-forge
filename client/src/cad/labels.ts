import type { Feature } from "./engine/types";
import type { Units } from "./engine/units";

export const MATERIALS = [
  { name: "Ti-6Al-4V (AMS 4928)", density: 4.43 },
  { name: "Aluminum 7075-T6", density: 2.81 },
  { name: "Aluminum 6061-T6", density: 2.7 },
  { name: "17-4 PH Stainless", density: 7.78 },
  { name: "Inconel 718", density: 8.19 },
  { name: "Carbon steel 4340", density: 7.85 },
];

/** Short description of a recognized feature, e.g. "Ø0.375 in thru, cbore Ø0.625 in". */
export function featureLabel(f: Feature, u: Units): string {
  switch (f.kind) {
    case "hole": {
      let s = `${u.dia(f.radius)} ${f.thru || f.depth == null ? "thru" : `x ${u.len(f.depth)}`}`;
      if (f.cbore) s += `, cbore ${u.dia(f.cbore.radius)}`;
      return s;
    }
    case "pattern":
      return `${f.count}x ${f.arrangement.toLowerCase()}`;
    case "fillet":
      return `${f.type} R${u.len(f.radius)}${f.edges > 1 ? ` (${f.edges})` : ""}`;
    case "boss":
      return `Boss ${u.dia(f.radius)}`;
  }
}

/** Key used to store engineer review status for a feature. */
export const reviewKey = (partName: string, featureName: string) => `${partName}#${featureName}`;
