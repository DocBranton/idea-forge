// Reads G-code from either slicer into layers of typed extrusion segments for the
// preview, plus time and filament totals per feature for the legend.
//
// Feature comments differ by slicer:
//   Kiri:Moto  "; feature shells"    (or a printer's own template, e.g. "; FEATURE: shells")
//   Orca       ";TYPE:Outer wall"
// Both are folded into the small set of kinds below.

export type FeatureKind =
  | "outer-wall"
  | "inner-wall"
  | "walls"
  | "infill"
  | "solid"
  | "top"
  | "bottom"
  | "bridge"
  | "gap"
  | "support"
  | "brim"
  | "other";

export interface FeatureInfo {
  kind: FeatureKind;
  label: string;
  color: string;
}

/** Legend order. Colors are picked to stay apart on the dark viewport. */
export const FEATURES: readonly FeatureInfo[] = [
  { kind: "outer-wall", label: "Outer wall", color: "#f5c542" },
  { kind: "inner-wall", label: "Inner wall", color: "#ffb067" },
  { kind: "walls", label: "Walls", color: "#f5c542" },
  { kind: "infill", label: "Sparse infill", color: "#ff7a59" },
  { kind: "solid", label: "Internal solid", color: "#c45bd6" },
  { kind: "top", label: "Top surface", color: "#9b7bff" },
  { kind: "bottom", label: "Bottom surface", color: "#5c8bff" },
  { kind: "bridge", label: "Bridge", color: "#3ee0ff" },
  { kind: "gap", label: "Gap fill", color: "#ff9fd0" },
  { kind: "support", label: "Support", color: "#34e28a" },
  { kind: "brim", label: "Brim / skirt", color: "#8aa3bd" },
  { kind: "other", label: "Other", color: "#5d758e" },
];
export const FEATURE_INDEX: Readonly<Record<FeatureKind, number>> = Object.fromEntries(
  FEATURES.map((f, i) => [f.kind, i]),
) as Record<FeatureKind, number>;

/** Map a slicer's feature name to a kind. Unknown names are "other". */
export function featureKind(raw: string): FeatureKind {
  const s = raw.trim().toLowerCase();
  if (s === "outer wall" || s === "overhang wall" || s === "external perimeter") return "outer-wall";
  if (s === "inner wall") return "inner-wall";
  if (s === "shells" || s === "wall" || s === "walls" || s === "perimeter") return "walls";
  if (s === "sparse infill" || s === "internal infill" || s === "infill") return "infill";
  if (s === "internal solid infill" || s === "solid fill" || s === "solid infill") return "solid";
  if (s === "top surface" || s === "top solid infill" || s === "ironing") return "top";
  if (s === "bottom surface") return "bottom";
  if (s.includes("bridge")) return "bridge";
  if (s === "gap infill" || s === "gap fill" || s === "thin fill") return "gap";
  if (s.startsWith("support")) return "support";
  if (s === "brim" || s === "skirt" || s === "skirt/brim") return "brim";
  return "other";
}

export interface GLayer {
  /** Height of the layer's extrusions, in mm. */
  z: number;
  /** Segment index range [start, end) into ParsedGcode.segs. */
  start: number;
  end: number;
}

export interface FeatureStat {
  seconds: number;
  /** Filament fed, in mm of filament. */
  filamentMm: number;
}

export interface ParsedGcode {
  layers: GLayer[];
  /** x0,y0,z0,x1,y1,z1 per extrusion segment, mm. */
  segs: Float32Array;
  /** FEATURES index per segment. */
  kinds: Uint8Array;
  stats: Partial<Record<FeatureKind, FeatureStat>>;
  /** Time from feedrates alone; ignores acceleration, so it runs short. */
  estimatedSeconds: number;
  /** Time the slicer itself reported in a comment, when it did. */
  reportedSeconds: number | null;
  /** Seconds spent on non-extruding moves. */
  travelSeconds: number;
  filamentMm: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

const FEATURE_RE = /^;\s*(?:feature|TYPE)\s*[:\s]\s*(.+?)\s*$/i;
// Orca / Prusa / Bambu: "; estimated printing time (normal mode) = 1h 2m 3s"
const TIME_RE = /^;\s*(?:estimated printing time(?: \(normal mode\))?|total estimated time)\s*[=:]\s*(.+)$/i;
// Kiri:Moto ends its output with "; --- print time: 494s ---".
const KIRI_TIME_RE = /^;\s*(?:--- )?print time\s*[:=]?\s*([\d.]+)\s*s?/i;

/** "1d 2h 3m 4s" → seconds. Null if nothing matched. */
export function parseDuration(text: string): number | null {
  let total = 0;
  let any = false;
  for (const m of text.matchAll(/([\d.]+)\s*([dhms])/g)) {
    any = true;
    const v = Number(m[1]);
    total += m[2] === "d" ? v * 86400 : m[2] === "h" ? v * 3600 : m[2] === "m" ? v * 60 : v;
  }
  return any ? total : null;
}

export interface ParseOptions {
  /**
   * Extrusion mode until the file sets one with M82/M83. Orca always sets it; Kiri:Moto
   * only does when the printer's start G-code does, and otherwise writes relative E
   * unless the printer profile says `extrudeAbs`.
   */
  absoluteE?: boolean;
}

/** Parse G-code text. Arcs (G2/G3) are drawn as their chord. */
export function parseGcode(text: string, opts: ParseOptions = {}): ParsedGcode {
  const segs: number[] = [];
  const kinds: number[] = [];
  const layers: GLayer[] = [];
  const stats: Partial<Record<FeatureKind, FeatureStat>> = {};

  let absXYZ = true;
  let absE = opts.absoluteE ?? true;
  let x = 0, y = 0, z = 0, e = 0;
  let feed = 1800; // mm/min until the file sets one
  let kind: FeatureKind = "other";
  let estimated = 0;
  let travel = 0;
  let filament = 0;
  let reported: number | null = null;
  let layer: GLayer | null = null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] === ";") {
      const f = FEATURE_RE.exec(line);
      if (f) {
        kind = featureKind(f[1]);
        continue;
      }
      const t = TIME_RE.exec(line);
      if (t) {
        const d = parseDuration(t[1]);
        if (d !== null) reported = d;
        continue;
      }
      const kt = KIRI_TIME_RE.exec(line);
      if (kt) reported = Number(kt[1]);
      continue;
    }
    const code = line.split(";", 1)[0].trim();
    const words = code.split(/\s+/);
    const cmd = words[0].toUpperCase();
    if (cmd === "G90") absXYZ = true;
    else if (cmd === "G91") absXYZ = false;
    else if (cmd === "M82") absE = true;
    else if (cmd === "M83") absE = false;
    else if (cmd === "G92") {
      for (const w of words.slice(1)) if (w[0]?.toUpperCase() === "E") e = Number(w.slice(1)) || 0;
    } else if (cmd === "G0" || cmd === "G1" || cmd === "G2" || cmd === "G3" || cmd === "G00" || cmd === "G01") {
      let nx = x, ny = y, nz = z, de = 0;
      for (const w of words.slice(1)) {
        const letter = w[0]?.toUpperCase();
        const v = Number(w.slice(1));
        if (!Number.isFinite(v)) continue;
        if (letter === "X") nx = absXYZ ? v : x + v;
        else if (letter === "Y") ny = absXYZ ? v : y + v;
        else if (letter === "Z") nz = absXYZ ? v : z + v;
        else if (letter === "E") {
          de = absE ? v - e : v;
          e = absE ? v : e + v;
        } else if (letter === "F" && v > 0) feed = v;
      }
      const dist = Math.hypot(nx - x, ny - y, nz - z);
      const secs = dist / (feed / 60);
      estimated += secs;
      const extruding = de > 1e-6 && (nx !== x || ny !== y);
      if (extruding) {
        // A new layer starts wherever extrusion resumes higher up. Z-hops are travel
        // moves, so they never open one. Extrusion that drops lower (a start-G-code purge
        // line drawn above the first layer) folds into the layer being built.
        if (!layer || nz > layer.z + 1e-4) {
          layer = { z: nz, start: kinds.length, end: kinds.length };
          layers.push(layer);
        } else if (nz < layer.z - 1e-4) {
          layer.z = nz;
        }
        segs.push(x, y, z, nx, ny, nz);
        kinds.push(FEATURE_INDEX[kind]);
        layer.end = kinds.length;
        filament += de;
        const s = (stats[kind] ??= { seconds: 0, filamentMm: 0 });
        s.seconds += secs;
        s.filamentMm += de;
        for (const [px, py, pz] of [[x, y, z], [nx, ny, nz]]) {
          if (px < min[0]) min[0] = px;
          if (py < min[1]) min[1] = py;
          if (pz < min[2]) min[2] = pz;
          if (px > max[0]) max[0] = px;
          if (py > max[1]) max[1] = py;
          if (pz > max[2]) max[2] = pz;
        }
      } else {
        travel += secs;
      }
      x = nx; y = ny; z = nz;
    }
  }
  return {
    layers,
    segs: Float32Array.from(segs),
    kinds: Uint8Array.from(kinds),
    stats,
    estimatedSeconds: estimated,
    reportedSeconds: reported,
    travelSeconds: travel,
    filamentMm: filament,
    bounds: Number.isFinite(min[0]) ? { min, max } : null,
  };
}

/** "2 h 48 m", "14 m", "40 s". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} m`;
}

/** Grams of filament for a length in mm, diameter in mm and density in g/cm³. */
export function filamentGrams(lengthMm: number, diameterMm: number, density: number): number {
  const areaMm2 = Math.PI * (diameterMm / 2) ** 2;
  return (lengthMm * areaMm2 * density) / 1000;
}
