// HTTP routes for server-side slicing with Orca.
//   GET  /api/slice/status   { orca: { available, printers[], reason? } }
//   POST /api/slice/orca     body: binary STL (application/octet-stream)
//                            header X-Slice-Settings: the slicer settings as JSON
//                            → text/x-gcode, or { error } with 400 / 409 / 503 / 500
// One Orca job runs at a time; a second request while one is running gets 409.
import { SliceInputError, orcaAvailability, parseSettings, runOrca, type OrcaConfig } from "./orca";

interface Req {
  header(name: string): string | undefined;
  body?: unknown;
  // Node's stream `on` has many overloads; one loose signature matches them all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (...args: any[]) => void): unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  send(body: string): unknown;
  setHeader(name: string, value: string): unknown;
}
type Handler = (req: Req, res: Res) => void | Promise<void>;
export interface SliceRouteHost {
  get(path: string, handler: Handler): unknown;
  post(path: string, handler: Handler): unknown;
}

export const MAX_STL_BYTES = 200 * 1024 * 1024;

/** The request body as bytes, whether or not a body parser already read it. */
export function readBody(req: Req, limit = MAX_STL_BYTES): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(new SliceInputError(`The part is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => !failed && resolve(Buffer.concat(chunks)));
    req.on("error", (e?: Error) => !failed && reject(e ?? new Error("upload failed")));
  });
}

/** True when the buffer is laid out as a binary STL. */
export function isBinaryStl(b: Buffer): boolean {
  if (b.length < 84) return false;
  const n = b.readUInt32LE(80);
  return n > 0 && b.length === 84 + n * 50;
}

export function registerSliceRoutes(
  app: SliceRouteHost,
  cfg: OrcaConfig | null,
  log: (msg: string, err?: unknown) => void = console.error,
  run: typeof runOrca = runOrca,
): void {
  let busy = false;

  app.get("/api/slice/status", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ orca: await orcaAvailability(cfg) });
  });

  app.post("/api/slice/orca", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const status = await orcaAvailability(cfg);
    if (!cfg || !status.available) {
      res.status(503).json({ error: status.reason ?? "Orca is not available on this server." });
      return;
    }
    if (busy) {
      res.status(409).json({ error: "Orca is slicing another part. Try again in a moment." });
      return;
    }
    busy = true;
    try {
      let settings;
      try {
        settings = parseSettings(JSON.parse(req.header("x-slice-settings") ?? "null"));
      } catch (e) {
        throw e instanceof SliceInputError ? e : new SliceInputError("X-Slice-Settings is not valid JSON.");
      }
      if (!status.printers.includes(settings.printer)) throw new SliceInputError(`This server has no Orca profiles for "${settings.printer}".`);
      const stl = await readBody(req);
      if (!isBinaryStl(stl)) throw new SliceInputError("The part must be sent as a binary STL.");
      const { gcode } = await run(cfg, stl, settings);
      res.setHeader("Content-Type", "text/x-gcode; charset=utf-8");
      res.status(200).send(gcode);
    } catch (e) {
      if (e instanceof SliceInputError) {
        res.status(400).json({ error: e.message });
      } else {
        log("[slice] Orca failed", e);
        res.status(500).json({ error: e instanceof Error ? e.message : "Orca could not slice the part." });
      }
    } finally {
      busy = false;
    }
  });
}
