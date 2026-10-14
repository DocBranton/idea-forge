// Printers, materials and the print settings the slicer screen exposes, and how those
// settings map onto Kiri:Moto's process options.
import kiriDevices from "./kiri-devices.json";

export type PrinterId = keyof typeof kiriDevices.devices;

export interface Printer {
  id: PrinterId;
  name: string;
  bed: { w: number; d: number; h: number };
  nozzle: number;
}

type KiriDevice = Record<string, unknown> & {
  deviceName: string;
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  extrudeAbs?: boolean;
  extruders: { extNozzle: number; extFilament: number }[];
};

const DEVICES = kiriDevices.devices as unknown as Record<PrinterId, KiriDevice>;

export const PRINTERS: readonly Printer[] = (Object.keys(DEVICES) as PrinterId[]).map((id) => {
  const d = DEVICES[id];
  return { id, name: d.deviceName, bed: { w: d.bedWidth, d: d.bedDepth, h: d.maxHeight }, nozzle: d.extruders[0]?.extNozzle ?? 0.4 };
});

export function printer(id: PrinterId): Printer {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS[0];
}

/** The Kiri:Moto device profile for a printer, as a fresh copy. */
export function kiriDevice(id: PrinterId): KiriDevice {
  return structuredClone(DEVICES[id] ?? DEVICES[PRINTERS[0].id]);
}

export type MaterialId = "pla" | "petg" | "abs" | "asa";
export interface Material {
  id: MaterialId;
  name: string;
  nozzle: number;
  bed: number;
  /** g/cm³ */
  density: number;
}
export const MATERIALS: readonly Material[] = [
  { id: "pla", name: "PLA", nozzle: 210, bed: 60, density: 1.24 },
  { id: "petg", name: "PETG", nozzle: 240, bed: 80, density: 1.27 },
  { id: "abs", name: "ABS", nozzle: 250, bed: 100, density: 1.04 },
  { id: "asa", name: "ASA", nozzle: 255, bed: 100, density: 1.07 },
];
export const material = (id: MaterialId) => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

export type InfillPattern = "gyroid" | "grid" | "triangles" | "honeycomb" | "lines";
export const INFILL_PATTERNS: readonly { id: InfillPattern; label: string }[] = [
  { id: "gyroid", label: "Gyroid" },
  { id: "grid", label: "Grid" },
  { id: "triangles", label: "Triangles" },
  { id: "honeycomb", label: "Honeycomb" },
  { id: "lines", label: "Lines" },
];

export interface SliceSettings {
  printer: PrinterId;
  material: MaterialId;
  layerHeight: number;
  wallLoops: number;
  topLayers: number;
  bottomLayers: number;
  /** 0–100 */
  infillDensity: number;
  infillPattern: InfillPattern;
  supports: boolean;
  /** Overhang angle from horizontal that needs support, degrees. */
  supportAngle: number;
  brim: boolean;
}

export interface Preset {
  id: string;
  name: string;
  layerHeight: number;
  topLayers: number;
  bottomLayers: number;
}
export const PRESETS: readonly Preset[] = [
  { id: "0.10", name: "0.10 mm Detail", layerHeight: 0.1, topLayers: 7, bottomLayers: 5 },
  { id: "0.20", name: "0.20 mm Standard", layerHeight: 0.2, topLayers: 5, bottomLayers: 4 },
  { id: "0.30", name: "0.30 mm Draft", layerHeight: 0.3, topLayers: 4, bottomLayers: 3 },
];

export const DEFAULT_SETTINGS: SliceSettings = {
  printer: "prusa-mk3s",
  material: "pla",
  layerHeight: 0.2,
  wallLoops: 3,
  topLayers: 5,
  bottomLayers: 4,
  infillDensity: 20,
  infillPattern: "gyroid",
  supports: false,
  supportAngle: 50,
  brim: false,
};

/** The preset whose values match, or null when the settings have been changed from it. */
export function matchingPreset(s: SliceSettings): Preset | null {
  return PRESETS.find((p) => p.layerHeight === s.layerHeight && p.topLayers === s.topLayers && p.bottomLayers === s.bottomLayers) ?? null;
}

/** Keys of `s` that differ from the defaults for its preset, for the "changed" markers. */
export function changedKeys(s: SliceSettings): Set<keyof SliceSettings> {
  const base = PRESETS.find((p) => p.layerHeight === s.layerHeight);
  const ref: SliceSettings = { ...DEFAULT_SETTINGS, ...(base ? { topLayers: base.topLayers, bottomLayers: base.bottomLayers } : {}) };
  const out = new Set<keyof SliceSettings>();
  for (const k of ["wallLoops", "topLayers", "bottomLayers", "infillDensity", "infillPattern", "supports", "supportAngle", "brim"] as const) {
    if (s[k] !== ref[k]) out.add(k);
  }
  return out;
}

const KIRI_FILL: Record<InfillPattern, string> = {
  gyroid: "gyroid",
  grid: "grid",
  triangles: "triangle",
  honeycomb: "hex",
  lines: "linear",
};

/** Kiri:Moto process options for the settings. Kiri merges these over its defaults. */
export function kiriProcess(s: SliceSettings): Record<string, unknown> {
  const m = material(s.material);
  return {
    sliceHeight: s.layerHeight,
    firstSliceHeight: Math.max(0.2, s.layerHeight),
    sliceShells: s.wallLoops,
    sliceTopLayers: s.topLayers,
    sliceBottomLayers: s.bottomLayers,
    sliceFillSparse: Math.min(1, Math.max(0, s.infillDensity / 100)),
    sliceFillType: s.infillDensity <= 0 ? "none" : KIRI_FILL[s.infillPattern],
    sliceSupportType: s.supports ? "automatic" : "disabled",
    sliceSupportEnable: s.supports,
    sliceSupportAngle: s.supportAngle,
    outputBrimCount: s.brim ? 5 : 0,
    outputTemp: m.nozzle,
    outputBedTemp: m.bed,
  };
}

/** Problems that stop a slice, in plain words. Empty when the part can be sliced. */
export function fitProblems(size: [number, number, number] | null, p: Printer): string[] {
  if (!size) return ["There is no part to slice."];
  const out: string[] = [];
  const [x, y, z] = size;
  // The slicers centre the part on the bed but don't rotate it to fit.
  if (!(x <= p.bed.w && y <= p.bed.d)) out.push(`The part is ${x.toFixed(0)} × ${y.toFixed(0)} mm; the ${p.name} bed is ${p.bed.w} × ${p.bed.d} mm.`);
  if (z > p.bed.h) out.push(`The part is ${z.toFixed(0)} mm tall; the ${p.name} prints up to ${p.bed.h} mm.`);
  return out;
}
