// OrcaSlicer on the server, run unmodified through its command line. Orca is AGPL-3.0,
// so it stays a separate program: we hand it an STL and its own JSON profiles, and read
// back the G-code file it writes. Nothing of Orca is linked into Idea Forge.
//
// Configuration (both required; without them Orca is reported unavailable):
//   ORCA_SLICER_BIN    path to the orca-slicer executable
//   ORCA_PROFILES_DIR  one folder per printer id (e.g. prusa-mk3s/) holding Orca's
//                      machine.json, process.json and filament.json, exported from Orca.
//                      filament-<material>.json (pla, petg, abs, asa) is used when present.
// Optional:
//   ORCA_TIMEOUT_MS    default 300000
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class SliceInputError extends Error {}

export interface OrcaConfig {
  bin: string;
  profilesDir: string;
  timeoutMs: number;
}

export interface OrcaAvailability {
  available: boolean;
  printers: string[];
  reason?: string;
}

const MATERIALS = ["pla", "petg", "abs", "asa"] as const;
const PATTERNS = { gyroid: "gyroid", grid: "grid", triangles: "triangles", honeycomb: "honeycomb", lines: "line" } as const;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface OrcaSettings {
  printer: string;
  material: (typeof MATERIALS)[number];
  layerHeight: number;
  wallLoops: number;
  topLayers: number;
  bottomLayers: number;
  infillDensity: number;
  infillPattern: keyof typeof PATTERNS;
  supports: boolean;
  supportAngle: number;
  brim: boolean;
}

export function orcaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OrcaConfig | null {
  const bin = env.ORCA_SLICER_BIN?.trim();
  const profilesDir = env.ORCA_PROFILES_DIR?.trim();
  if (!bin || !profilesDir) return null;
  const t = Number(env.ORCA_TIMEOUT_MS);
  return { bin, profilesDir, timeoutMs: Number.isFinite(t) && t > 0 ? t : 300_000 };
}

const isFile = async (p: string) => (await stat(p).catch(() => null))?.isFile() ?? false;

/** Printer ids with a complete set of Orca profiles. */
export async function profiledPrinters(profilesDir: string): Promise<string[]> {
  const entries = await readdir(profilesDir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID.test(e.name)) continue;
    const dir = join(profilesDir, e.name);
    const files = await readdir(dir).catch(() => [] as string[]);
    const filament = files.includes("filament.json") || files.some((f) => /^filament-[a-z]+\.json$/.test(f));
    if (files.includes("machine.json") && files.includes("process.json") && filament) out.push(e.name);
  }
  return out.sort();
}

export async function orcaAvailability(cfg: OrcaConfig | null): Promise<OrcaAvailability> {
  if (!cfg) return { available: false, printers: [], reason: "Orca is not installed on this server." };
  if (!(await isFile(cfg.bin))) return { available: false, printers: [], reason: "The Orca program configured on this server was not found." };
  const printers = await profiledPrinters(cfg.profilesDir);
  if (!printers.length) return { available: false, printers, reason: "No Orca printer profiles are set up on this server." };
  return { available: true, printers };
}

function num(raw: Record<string, unknown>, key: string, min: number, max: number, integer = false): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new SliceInputError(`${key} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
  }
  return v;
}

function bool(raw: Record<string, unknown>, key: string): boolean {
  if (typeof raw[key] !== "boolean") throw new SliceInputError(`${key} must be true or false.`);
  return raw[key] as boolean;
}

/** Validate settings from the browser. Throws SliceInputError with a plain message. */
export function parseSettings(input: unknown): OrcaSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new SliceInputError("Slice settings are missing.");
  const raw = input as Record<string, unknown>;
  const printer = raw.printer;
  if (typeof printer !== "string" || !ID.test(printer)) throw new SliceInputError("printer is not a valid printer id.");
  const material = raw.material;
  if (typeof material !== "string" || !(MATERIALS as readonly string[]).includes(material)) throw new SliceInputError(`material must be one of ${MATERIALS.join(", ")}.`);
  const pattern = raw.infillPattern;
  if (typeof pattern !== "string" || !(pattern in PATTERNS)) throw new SliceInputError(`infillPattern must be one of ${Object.keys(PATTERNS).join(", ")}.`);
  return {
    printer,
    material: material as OrcaSettings["material"],
    layerHeight: num(raw, "layerHeight", 0.05, 0.6),
    wallLoops: num(raw, "wallLoops", 1, 20, true),
    topLayers: num(raw, "topLayers", 0, 50, true),
    bottomLayers: num(raw, "bottomLayers", 0, 50, true),
    infillDensity: num(raw, "infillDensity", 0, 100),
    infillPattern: pattern as OrcaSettings["infillPattern"],
    supports: bool(raw, "supports"),
    supportAngle: num(raw, "supportAngle", 0, 90),
    brim: bool(raw, "brim"),
  };
}

/** Orca process-profile keys for the settings. Orca's JSON profiles store values as strings. */
export function processOverrides(s: OrcaSettings): Record<string, string> {
  return {
    layer_height: String(s.layerHeight),
    initial_layer_print_height: String(Math.max(0.2, s.layerHeight)),
    wall_loops: String(s.wallLoops),
    top_shell_layers: String(s.topLayers),
    bottom_shell_layers: String(s.bottomLayers),
    sparse_infill_density: `${s.infillDensity}%`,
    sparse_infill_pattern: PATTERNS[s.infillPattern],
    enable_support: s.supports ? "1" : "0",
    support_type: "normal(auto)",
    support_threshold_angle: String(Math.round(s.supportAngle)),
    brim_type: s.brim ? "outer_only" : "no_brim",
  };
}

async function findGcode(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  const hit = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gcode")).map((e) => join(e.parentPath ?? dir, e.name)).sort();
  return hit[0] ?? null;
}

export interface OrcaRun {
  gcode: string;
  args: string[];
}

/** Slice a binary STL with Orca. Rejects with a message safe to show the user. */
export async function runOrca(cfg: OrcaConfig, stl: Buffer, s: OrcaSettings): Promise<OrcaRun> {
  const dir = join(cfg.profilesDir, s.printer);
  const machine = join(dir, "machine.json");
  const filament = (await isFile(join(dir, `filament-${s.material}.json`))) ? join(dir, `filament-${s.material}.json`) : join(dir, "filament.json");
  if (!(await isFile(machine)) || !(await isFile(join(dir, "process.json"))) || !(await isFile(filament))) {
    throw new SliceInputError(`This server has no Orca profiles for "${s.printer}".`);
  }
  const work = await mkdtemp(join(tmpdir(), "orca-"));
  try {
    const base = JSON.parse(await readFile(join(dir, "process.json"), "utf8")) as Record<string, unknown>;
    const proc = join(work, "process.json");
    await writeFile(proc, JSON.stringify({ ...base, ...processOverrides(s) }, null, 1));
    const model = join(work, "part.stl");
    await writeFile(model, stl);
    const out = join(work, "out");
    const args = [model, "--load-settings", `${proc};${machine}`, "--load-filaments", filament, "--arrange", "1", "--slice", "0", "--outputdir", out];
    const { code, stderr } = await exec(cfg.bin, args, cfg.timeoutMs);
    if (code !== 0) {
      const tail = stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
      throw new Error(`Orca stopped with code ${code}${tail ? `: ${tail}` : ""}.`);
    }
    const file = await findGcode(out);
    if (!file) throw new Error("Orca finished but wrote no G-code. Check that the part fits the printer's bed.");
    return { gcode: await readFile(file, "utf8"), args };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function exec(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Orca took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Orca could not be started: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}
