// Orca slicing against a stand-in orca-slicer: a shell script that checks its arguments
// the way the real CLI takes them and writes plate_1.gcode into --outputdir.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SliceInputError, orcaAvailability, orcaConfigFromEnv, parseSettings, processOverrides, profiledPrinters, runOrca, type OrcaConfig } from "./orca";
import { isBinaryStl, registerSliceRoutes, type SliceRouteHost } from "./slice-routes";

const settings = {
  printer: "prusa-mk3s",
  material: "petg",
  layerHeight: 0.2,
  wallLoops: 3,
  topLayers: 5,
  bottomLayers: 4,
  infillDensity: 40,
  infillPattern: "gyroid",
  supports: true,
  supportAngle: 50,
  brim: false,
};

// A one-triangle binary STL.
function stl(): Buffer {
  const b = Buffer.alloc(84 + 50);
  b.writeUInt32LE(1, 80);
  [0, 0, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((v, i) => b.writeFloatLE(v, 84 + i * 4));
  return b;
}

// Writes the merged process profile and the arguments into the G-code, so tests can see them.
const FAKE = `#!/bin/sh
out=""; settings=""; model="$1"
while [ $# -gt 0 ]; do
  case "$1" in
    --outputdir) out="$2"; shift ;;
    --load-settings) settings="$2"; shift ;;
  esac
  shift
done
case "$model" in *.stl) ;; *) echo "no model" >&2; exit 3 ;; esac
[ -n "$out" ] || { echo "no outputdir" >&2; exit 2; }
proc=$(echo "$settings" | cut -d';' -f1)
mkdir -p "$out"
{ echo ";TYPE:Outer wall"; echo "; process: $(tr -d '\\n' < "$proc")"; echo "G1 X1 Y1 E1"; } > "$out/plate_1.gcode"
`;

describe("Orca slicing", () => {
  let root: string;
  let cfg: OrcaConfig;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "orca-test-"));
    const bin = join(root, "orca-slicer");
    await writeFile(bin, FAKE);
    await chmod(bin, 0o755);
    const profiles = join(root, "profiles");
    for (const id of ["prusa-mk3s", "bambu-p1s", "half-done"]) await mkdir(join(profiles, id), { recursive: true });
    await writeFile(join(profiles, "prusa-mk3s", "machine.json"), "{}");
    await writeFile(join(profiles, "prusa-mk3s", "process.json"), JSON.stringify({ name: "0.20mm", layer_height: "0.3", wall_loops: "2" }));
    await writeFile(join(profiles, "prusa-mk3s", "filament.json"), "{}");
    await writeFile(join(profiles, "bambu-p1s", "machine.json"), "{}");
    await writeFile(join(profiles, "bambu-p1s", "process.json"), "{}");
    await writeFile(join(profiles, "bambu-p1s", "filament-pla.json"), "{}");
    await writeFile(join(profiles, "half-done", "machine.json"), "{}");
    cfg = { bin, profilesDir: profiles, timeoutMs: 10_000 };
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("configuration comes from the environment", () => {
    assert.equal(orcaConfigFromEnv({}), null);
    assert.equal(orcaConfigFromEnv({ ORCA_SLICER_BIN: "/x" }), null);
    assert.deepEqual(orcaConfigFromEnv({ ORCA_SLICER_BIN: "/x", ORCA_PROFILES_DIR: "/p", ORCA_TIMEOUT_MS: "5000" }), { bin: "/x", profilesDir: "/p", timeoutMs: 5000 });
  });

  test("only printers with a full set of profiles are offered", async () => {
    assert.deepEqual(await profiledPrinters(cfg.profilesDir), ["bambu-p1s", "prusa-mk3s"]);
    assert.deepEqual(await orcaAvailability(cfg), { available: true, printers: ["bambu-p1s", "prusa-mk3s"] });
    assert.equal((await orcaAvailability(null)).available, false);
    assert.equal((await orcaAvailability({ ...cfg, bin: join(root, "missing") })).available, false);
  });

  test("settings are validated", () => {
    assert.equal(parseSettings(settings).infillPattern, "gyroid");
    assert.throws(() => parseSettings(null), SliceInputError);
    assert.throws(() => parseSettings({ ...settings, printer: "../etc" }), /printer/);
    assert.throws(() => parseSettings({ ...settings, wallLoops: 2.5 }), /wallLoops/);
    assert.throws(() => parseSettings({ ...settings, layerHeight: 2 }), /layerHeight/);
    assert.throws(() => parseSettings({ ...settings, material: "nylon" }), /material/);
    assert.throws(() => parseSettings({ ...settings, supports: "yes" }), /supports/);
  });

  test("settings become Orca process keys", () => {
    const o = processOverrides(parseSettings({ ...settings, infillPattern: "lines", brim: true, layerHeight: 0.1 }));
    assert.equal(o.layer_height, "0.1");
    assert.equal(o.initial_layer_print_height, "0.2");
    assert.equal(o.sparse_infill_density, "40%");
    assert.equal(o.sparse_infill_pattern, "line");
    assert.equal(o.enable_support, "1");
    assert.equal(o.brim_type, "outer_only");
  });

  test("runs Orca with the merged profile and returns its G-code", async () => {
    const { gcode, args } = await runOrca(cfg, stl(), parseSettings(settings));
    assert.match(gcode, /;TYPE:Outer wall/);
    // Our values win over the stored profile; the profile's other keys are kept.
    assert.match(gcode, /"layer_height":\s*"0.2"/);
    assert.match(gcode, /"wall_loops":\s*"3"/);
    assert.match(gcode, /"name":\s*"0.20mm"/);
    assert.deepEqual(args.slice(-6), ["--arrange", "1", "--slice", "0", "--outputdir", args[args.length - 1]]);
    assert.ok(args[4].endsWith(join("prusa-mk3s", "filament.json")));
  });

  test("a per-material filament profile is used when there is one", async () => {
    const { args } = await runOrca(cfg, stl(), parseSettings({ ...settings, printer: "bambu-p1s", material: "pla" }));
    assert.ok(args[4].endsWith(join("bambu-p1s", "filament-pla.json")));
  });

  test("Orca failures come back as messages", async () => {
    const bad = join(root, "bad-orca");
    await writeFile(bad, "#!/bin/sh\necho 'Nothing to be sliced' >&2\nexit 7\n");
    await chmod(bad, 0o755);
    await assert.rejects(runOrca({ ...cfg, bin: bad }, stl(), parseSettings(settings)), /code 7: Nothing to be sliced/);
    const silent = join(root, "silent-orca");
    await writeFile(silent, "#!/bin/sh\nexit 0\n");
    await chmod(silent, 0o755);
    await assert.rejects(runOrca({ ...cfg, bin: silent }, stl(), parseSettings(settings)), /wrote no G-code/);
    const slow = join(root, "slow-orca");
    await writeFile(slow, "#!/bin/sh\nsleep 5\n");
    await chmod(slow, 0o755);
    await assert.rejects(runOrca({ ...cfg, bin: slow, timeoutMs: 200 }, stl(), parseSettings(settings)), /longer than/);
    await assert.rejects(runOrca(cfg, stl(), parseSettings({ ...settings, printer: "half-done" })), SliceInputError);
  });

  describe("routes", () => {
    type Handler = (req: unknown, res: unknown) => Promise<void> | void;
    function host() {
      const routes: Record<string, Handler> = {};
      const app: SliceRouteHost = {
        get: (p, h) => (routes[`GET ${p}`] = h as Handler),
        post: (p, h) => (routes[`POST ${p}`] = h as Handler),
      };
      return { app, routes };
    }
    function res() {
      const r = {
        code: 200,
        body: undefined as unknown,
        headers: {} as Record<string, string>,
        status(c: number) {
          r.code = c;
          return r;
        },
        json(b: unknown) {
          r.body = b;
        },
        send(b: string) {
          r.body = b;
        },
        setHeader(k: string, v: string) {
          r.headers[k.toLowerCase()] = v;
        },
      };
      return r;
    }
    const req = (body: Buffer, headers: Record<string, string>) => ({
      body,
      header: (n: string) => headers[n.toLowerCase()],
      on: () => undefined,
    });

    test("status reports what the server can do", async () => {
      const { app, routes } = host();
      registerSliceRoutes(app, null);
      const r = res();
      await routes["GET /api/slice/status"](req(Buffer.alloc(0), {}), r);
      assert.deepEqual(r.body, { orca: { available: false, printers: [], reason: "Orca is not installed on this server." } });
    });

    test("slicing returns G-code, and bad input is a 400", async () => {
      const { app, routes } = host();
      registerSliceRoutes(app, cfg, () => {});
      const post = routes["POST /api/slice/orca"];
      const ok = res();
      await post(req(stl(), { "x-slice-settings": JSON.stringify(settings) }), ok);
      assert.equal(ok.code, 200);
      assert.match(String(ok.body), /;TYPE:Outer wall/);
      assert.equal(ok.headers["content-type"], "text/x-gcode; charset=utf-8");

      const notStl = res();
      await post(req(Buffer.from("solid x"), { "x-slice-settings": JSON.stringify(settings) }), notStl);
      assert.equal(notStl.code, 400);

      const noProfile = res();
      await post(req(stl(), { "x-slice-settings": JSON.stringify({ ...settings, printer: "creality-k1" }) }), noProfile);
      assert.equal(noProfile.code, 400);
      assert.match((noProfile.body as { error: string }).error, /no Orca profiles/);

      const badJson = res();
      await post(req(stl(), { "x-slice-settings": "{" }), badJson);
      assert.equal(badJson.code, 400);
    });

    test("without Orca the slice route is a 503", async () => {
      const { app, routes } = host();
      registerSliceRoutes(app, null);
      const r = res();
      await routes["POST /api/slice/orca"](req(stl(), { "x-slice-settings": JSON.stringify(settings) }), r);
      assert.equal(r.code, 503);
    });

    test("one job at a time", async () => {
      const { app, routes } = host();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      registerSliceRoutes(app, cfg, () => {}, async () => {
        await gate;
        return { gcode: "G1", args: [] };
      });
      const post = routes["POST /api/slice/orca"];
      const first = res();
      const running = post(req(stl(), { "x-slice-settings": JSON.stringify(settings) }), first);
      // Let the first request reach the slicer before the second arrives.
      await new Promise((r) => setTimeout(r, 50));
      const second = res();
      await post(req(stl(), { "x-slice-settings": JSON.stringify(settings) }), second);
      assert.equal(second.code, 409);
      release();
      await running;
      assert.equal(first.code, 200);
    });
  });

  test("binary STL check", () => {
    assert.ok(isBinaryStl(stl()));
    assert.ok(!isBinaryStl(Buffer.from("solid cube\nendsolid cube\n")));
  });
});
