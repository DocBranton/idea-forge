// Runs Kiri:Moto's slicing engine in the browser. The engine and its workers are the
// vendored bundle in client/public/vendor/kiri (built from the commit in scripts/kiri.lock);
// they load the first time someone slices, not with the app.
import { kiriDevice, kiriProcess, type SliceSettings } from "./profiles";

const BASE = "/vendor/kiri/lib/kiri/run";

interface KiriEngine {
  setListener(fn: (msg: Record<string, unknown>) => void): KiriEngine;
  parse(data: ArrayBuffer | string): Promise<KiriEngine>;
  setDevice(device: Record<string, unknown>): KiriEngine;
  setProcess(process: Record<string, unknown>): KiriEngine;
  slice(): Promise<KiriEngine>;
  prepare(): Promise<KiriEngine>;
  export(): Promise<string>;
}
type EngineCtor = new (opts: { workURL: string; poolURL: string }) => KiriEngine;

let engineModule: Promise<{ Engine: EngineCtor }> | null = null;
function loadEngine(): Promise<{ Engine: EngineCtor }> {
  // A runtime URL, not a bundled import: Vite must leave it alone.
  engineModule ??= import(/* @vite-ignore */ `${BASE}/engine.js`) as Promise<{ Engine: EngineCtor }>;
  engineModule.catch(() => (engineModule = null));
  return engineModule;
}

export type SliceStage = "loading" | "slicing" | "routing" | "exporting";

export interface KiriResult {
  gcode: string;
  /** Whether the G-code uses absolute E when the file doesn't say (see parseGcode). */
  absoluteE: boolean;
  ms: number;
}

/** Slice a binary STL (millimetres) with Kiri:Moto. */
export async function sliceWithKiri(stl: ArrayBuffer, settings: SliceSettings, onStage: (s: SliceStage) => void = () => {}): Promise<KiriResult> {
  const t0 = performance.now();
  onStage("loading");
  const { Engine } = await loadEngine();
  const device = kiriDevice(settings.printer);
  const engine = new Engine({ workURL: `${BASE}/worker.js`, poolURL: `${BASE}/minion.js` });
  // parse() takes ownership of the buffer; hand it a copy so the caller can reuse the STL.
  await engine.parse(stl.slice(0));
  engine.setDevice(device).setProcess(kiriProcess(settings));
  onStage("slicing");
  await engine.slice();
  onStage("routing");
  await engine.prepare();
  onStage("exporting");
  const gcode = await engine.export();
  return { gcode, absoluteE: device.extrudeAbs === true, ms: performance.now() - t0 };
}
