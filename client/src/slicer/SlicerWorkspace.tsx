// Produce stage slicer. Layout and workflow follow OrcaSlicer (Prepare / Preview tabs,
// one settings sidebar, a line-type legend, layer and move sliders); the code and icons
// are Idea Forge's own. Kiri:Moto does the slicing, in the browser; nothing is uploaded.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, Box, Download, FolderOpen, Home, Layers, Pause, Play, Printer as PrinterIcon } from "lucide-react";
import { currentModel, onModel, type HandoffPart } from "@/cad/handoff";
import { buildSampleBracket } from "@/cad/engine/sample";
import { CAD_EXTENSIONS, loadCadFile } from "@/cad/engine/loaders";
import type { ModelData } from "@/cad/engine/types";
import { FEATURES, filamentGrams, formatDuration, parseGcode, type FeatureKind, type ParsedGcode } from "./gcode";
import { sliceWithKiri, type SliceStage } from "./kiri";
import { SlicePreview } from "./preview";
import {
  DEFAULT_SETTINGS,
  INFILL_PATTERNS,
  MATERIALS,
  PRESETS,
  PRINTERS,
  changedKeys,
  fitProblems,
  material,
  matchingPreset,
  printer,
  type InfillPattern,
  type MaterialId,
  type PrinterId,
  type SliceSettings,
} from "./profiles";
import { meshBounds, modelToStl } from "./stl";
import "./slicer.css";

type View = "prepare" | "preview" | "printers";
type Section = "quality" | "strength" | "support" | "others";

interface Part {
  model: ModelData;
  source: string;
  /** Mesh indexes on the plate. Fasteners start off it. */
  included: number[];
}

const FASTENER = /\b(shcs|bhcs|fhcs|screw|bolt|nut|washer|rivet|fastener)s?\b/i;

/** Every mesh except fasteners, unless that would leave nothing. */
function plateParts(m: ModelData): number[] {
  const all = m.meshes.map((_, i) => i);
  const parts = all.filter((i) => !m.meshes[i].keepColor && !FASTENER.test(m.meshes[i].name));
  return parts.length ? parts : all;
}

const partKey = (p: Part) => `${p.model.fileName}|${p.model.meshes.length}|${p.included.join(",")}`;

interface Sliced {
  gcode: string;
  parsed: ParsedGcode;
  settings: SliceSettings;
  partKey: string;
  ms: number;
  at: Date;
}

const STORE_KEY = "foundry:slicer:settings";

function loadSettings(): SliceSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SliceSettings>) };
    if (!PRINTERS.some((p) => p.id === s.printer)) s.printer = DEFAULT_SETTINGS.printer;
    if (!MATERIALS.some((m) => m.id === s.material)) s.material = DEFAULT_SETTINGS.material;
    return s;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: SliceSettings): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Private windows and blocked storage: settings just aren't remembered.
  }
}

function fromHandoff(h: HandoffPart): Part {
  const time = h.openedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { model: h.model, source: `From the CAD workspace · opened ${time}`, included: plateParts(h.model) };
}

function partNow(): Part {
  const h = currentModel();
  if (h) return fromHandoff(h);
  const model = buildSampleBracket();
  return { model, source: "Sample part · open a file or a part in Design", included: plateParts(model) };
}

const STAGE_LABEL: Record<SliceStage, string> = {
  loading: "Loading the slicer…",
  slicing: "Slicing layers…",
  routing: "Planning toolpaths…",
  exporting: "Writing G-code…",
};

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/x-gcode" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = (file: string) => file.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "part";

export interface SlicerWorkspaceProps {
  onPing?: (msg: string) => void;
}

export default function SlicerWorkspace({ onPing }: SlicerWorkspaceProps) {
  const [part, setPart] = useState<Part>(partNow);
  const [settings, setSettings] = useState<SliceSettings>(loadSettings);
  const [view, setView] = useState<View>("prepare");
  const [section, setSection] = useState<Section>("strength");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sliced, setSliced] = useState<Sliced | null>(null);
  const [layer, setLayer] = useState(0);
  const [moves, setMoves] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [hidden, setHidden] = useState<Set<FeatureKind>>(new Set());

  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<SlicePreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ping = useCallback((m: string) => onPing?.(m), [onPing]);

  const prn = printer(settings.printer);
  const meshes = useMemo(() => part.included.map((i) => part.model.meshes[i]), [part]);
  const bounds = useMemo(() => meshBounds(part.model, meshes), [part, meshes]);
  const size = bounds ? ([0, 1, 2].map((a) => bounds.max[a] - bounds.min[a]) as [number, number, number]) : null;
  const problems = fitProblems(size, prn);
  const changed = changedKeys(settings);
  const preset = matchingPreset(settings);
  const stale = sliced !== null && (JSON.stringify(sliced.settings) !== JSON.stringify(settings) || sliced.partKey !== partKey(part));

  // Parts opened in Design or Validate while this page is up.
  useEffect(
    () =>
      onModel((h) => {
        if (!h) return;
        setPart(fromHandoff(h));
        setSliced(null);
      }),
    [],
  );
  useEffect(() => saveSettings(settings), [settings]);

  // The 3D view.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let p: SlicePreview;
    try {
      p = new SlicePreview(host);
    } catch (e) {
      setError(`3D view unavailable: ${(e as Error).message}`);
      return;
    }
    previewRef.current = p;
    return () => {
      p.dispose();
      previewRef.current = null;
    };
  }, []);
  useEffect(() => {
    const p = previewRef.current;
    if (!p) return;
    p.setPrinter(prn);
    p.setPart(meshes, part.model.mmPerUnit, view !== "preview" || !sliced);
    // view and sliced are read once here; the next effect keeps them in sync.
  }, [prn, meshes]);
  useEffect(() => {
    const p = previewRef.current;
    if (!p) return;
    const showPaths = view === "preview" && !!sliced;
    p.setGcode(showPaths ? sliced.parsed : null);
    p.showPart(!showPaths);
    if (showPaths) {
      const top = sliced.parsed.layers.length - 1;
      setLayer(top);
      setMoves(100);
    }
  }, [view, sliced]);
  useEffect(() => previewRef.current?.setHidden(hidden), [hidden]);
  useEffect(() => previewRef.current?.setRange(layer, moves / 100), [layer, moves]);

  // Play: step up through the layers.
  useEffect(() => {
    if (!playing || !sliced) return;
    const last = sliced.parsed.layers.length - 1;
    const t = setInterval(() => {
      setLayer((l) => {
        if (l >= last) {
          setPlaying(false);
          return l;
        }
        return l + 1;
      });
    }, 120);
    return () => clearInterval(t);
  }, [playing, sliced]);

  const update = <K extends keyof SliceSettings>(k: K, v: SliceSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) setSettings((s) => ({ ...s, layerHeight: p.layerHeight, topLayers: p.topLayers, bottomLayers: p.bottomLayers }));
  };

  const finish = useCallback(
    (gcode: string, absoluteE: boolean, ms: number, used: SliceSettings, key: string) => {
      const parsed = parseGcode(gcode, { absoluteE });
      if (parsed.layers.length === 0) throw new Error("The slicer returned G-code with no printed layers.");
      setSliced({ gcode, parsed, settings: used, partKey: key, ms, at: new Date() });
      setHidden(new Set());
      setView("preview");
      return parsed;
    },
    [],
  );

  const sliceKiri = useCallback(async () => {
    if (busy) return;
    setError(null);
    const used = settings;
    try {
      const stl = modelToStl(part.model, meshes);
      const r = await sliceWithKiri(stl, used, (s) => setBusy(STAGE_LABEL[s]));
      const parsed = finish(r.gcode, r.absoluteE, r.ms, used, partKey(part));
      ping(`Sliced ${part.model.name}: ${parsed.layers.length} layers in ${(r.ms / 1000).toFixed(1)} s`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, settings, part, meshes, finish, ping]);

  const exportGcode = useCallback(() => {
    if (!sliced) return;
    download(sliced.gcode, `${baseName(part.model.fileName)}-${sliced.settings.printer}.gcode`);
  }, [sliced, part]);

  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setBusy(`Reading ${f.name}…`);
    try {
      const m = await loadCadFile(f, (msg) => setBusy(msg));
      setPart({ model: m, source: `Opened here · ${f.name}`, included: plateParts(m) });
      setSliced(null);
      setView("prepare");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Legend rows: the features this slice actually has, in legend order.
  const legend = useMemo(() => {
    if (!sliced) return [];
    const st = sliced.parsed.stats;
    const total = Object.values(st).reduce((t, s) => t + (s?.seconds ?? 0), 0) || 1;
    return FEATURES.filter((f) => st[f.kind]).map((f) => ({ ...f, seconds: st[f.kind]!.seconds, share: st[f.kind]!.seconds / total }));
  }, [sliced]);

  const g = sliced?.parsed;
  const layers = g?.layers.length ?? 0;
  const mat = material(settings.material);
  const grams = g ? filamentGrams(g.filamentMm, 1.75, material(sliced!.settings.material).density) : 0;
  const total = g ? g.reportedSeconds ?? g.estimatedSeconds : 0;
  const canSlice = !busy && problems.length === 0;

  return (
    <div className="slc">
      <div className="slc-bar">
        <nav className="slc-tabs" aria-label="Workflow">
          <button type="button" className={view === "prepare" ? "on" : ""} aria-pressed={view === "prepare"} onClick={() => setView("prepare")}>
            <Box size={15} /> Prepare
          </button>
          <button
            type="button"
            className={view === "preview" ? "on" : ""}
            aria-pressed={view === "preview"}
            disabled={!sliced}
            title={sliced ? undefined : "Slice the plate first"}
            onClick={() => setView("preview")}
          >
            <Layers size={15} /> Preview
          </button>
          <button type="button" className={view === "printers" ? "on" : ""} aria-pressed={view === "printers"} onClick={() => setView("printers")}>
            <PrinterIcon size={15} /> Printers
          </button>
        </nav>
        <span className="slc-grow" />
        <span className="slc-state" role="status">
          {busy ? (
            <>
              <span className="slc-dot busy" /> {busy}
            </>
          ) : sliced ? (
            <>
              <span className={`slc-dot ${stale ? "stale" : "ok"}`} />
              {stale ? "Settings changed · slice again" : "Sliced with Kiri:Moto"}
            </>
          ) : (
            "Not sliced yet"
          )}
        </span>
        <button type="button" className="slc-btn" disabled={!canSlice} onClick={() => void sliceKiri()}>
          Slice plate
        </button>
        <button type="button" className="slc-btn primary" disabled={!sliced || !!busy || stale} title={stale ? "Slice again to export the current settings" : undefined} onClick={exportGcode}>
          <Download size={15} /> Export G-code
        </button>
      </div>

      <div className="slc-main">
        <aside className="slc-side" aria-label="Print settings">
          <section className="slc-sec">
            <h4>Printer</h4>
            <select aria-label="Printer" value={settings.printer} onChange={(e) => update("printer", e.target.value as PrinterId)}>
              {PRINTERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.nozzle} nozzle
                </option>
              ))}
            </select>
            <small>
              Bed {prn.bed.w} × {prn.bed.d} × {prn.bed.h} mm
            </small>
          </section>

          <section className="slc-sec">
            <h4>Filament</h4>
            <div className="slc-fil">
              <span className="slc-slot">1</span>
              <select aria-label="Filament" value={settings.material} onChange={(e) => update("material", e.target.value as MaterialId)}>
                {MATERIALS.map((m) => (
                  <option key={m.id} value={m.id}>
                    Generic {m.name}
                  </option>
                ))}
              </select>
              <small>
                {mat.nozzle} / {mat.bed} °C
              </small>
            </div>
          </section>

          <section className="slc-sec">
            <div className="slc-sec-head">
              <h4>Objects</h4>
              <button type="button" className="slc-link" onClick={() => fileRef.current?.click()}>
                <FolderOpen size={13} /> Open
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept={CAD_EXTENSIONS.map((x) => `.${x}`).join(",")}
                onChange={(e) => void openFile(e)}
              />
            </div>
            <div className="slc-obj">
              <Box size={14} />
              <span>{part.model.name}</span>
              {settings.supports ? <span className="slc-chip">Supports</span> : null}
            </div>
            {part.model.meshes.length > 1 ? (
              <ul className="slc-parts" aria-label="Parts on the plate">
                {part.model.meshes.map((m, i) => (
                  <li key={`${i}-${m.name}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={part.included.includes(i)}
                        onChange={(e) =>
                          setPart((p) => ({
                            ...p,
                            included: e.target.checked ? [...p.included, i].sort((a, b) => a - b) : p.included.filter((x) => x !== i),
                          }))
                        }
                      />
                      <span>{m.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <small>{part.source}</small>
            {size ? (
              <small>
                {size[0].toFixed(1)} × {size[1].toFixed(1)} × {size[2].toFixed(1)} mm
              </small>
            ) : null}
          </section>

          <section className="slc-sec grow">
            <div className="slc-sec-head">
              <h4>Process</h4>
            </div>
            <select aria-label="Process preset" value={preset?.id ?? ""} onChange={(e) => applyPreset(e.target.value)}>
              {preset ? null : <option value="">Custom ({settings.layerHeight} mm)</option>}
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {preset?.id === p.id && changed.size ? " (modified)" : ""}
                </option>
              ))}
            </select>
            <nav className="slc-subtabs" aria-label="Process sections">
              {(["quality", "strength", "support", "others"] as const).map((s) => (
                <button key={s} type="button" className={section === s ? "on" : ""} aria-pressed={section === s} onClick={() => setSection(s)}>
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </nav>

            {section === "quality" ? (
              <div className="slc-fields">
                <span className="slc-group">Layer height</span>
                <Num label="Layer height (mm)" value={settings.layerHeight} min={0.05} max={0.4} step={0.05} onChange={(v) => update("layerHeight", v)} />
                <p className="slc-note">Speeds and accelerations come from the printer profile.</p>
              </div>
            ) : null}
            {section === "strength" ? (
              <div className="slc-fields">
                <span className="slc-group">Walls</span>
                <Num label="Wall loops" value={settings.wallLoops} min={1} max={10} changed={changed.has("wallLoops")} onChange={(v) => update("wallLoops", v)} />
                <span className="slc-group">Top / bottom shells</span>
                <Num label="Top layers" value={settings.topLayers} min={0} max={20} changed={changed.has("topLayers")} onChange={(v) => update("topLayers", v)} />
                <Num label="Bottom layers" value={settings.bottomLayers} min={0} max={20} changed={changed.has("bottomLayers")} onChange={(v) => update("bottomLayers", v)} />
                <span className="slc-group">Sparse infill</span>
                <Num label="Density (%)" value={settings.infillDensity} min={0} max={100} step={5} changed={changed.has("infillDensity")} onChange={(v) => update("infillDensity", v)} />
                <label className={`slc-field ${changed.has("infillPattern") ? "changed" : ""}`}>
                  <span>Pattern</span>
                  <select value={settings.infillPattern} onChange={(e) => update("infillPattern", e.target.value as InfillPattern)}>
                    {INFILL_PATTERNS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {section === "support" ? (
              <div className="slc-fields">
                <label className={`slc-field ${changed.has("supports") ? "changed" : ""}`}>
                  <span>Enable support</span>
                  <input type="checkbox" checked={settings.supports} onChange={(e) => update("supports", e.target.checked)} />
                </label>
                <Num
                  label="Threshold angle (°)"
                  value={settings.supportAngle}
                  min={10}
                  max={80}
                  step={5}
                  disabled={!settings.supports}
                  changed={changed.has("supportAngle")}
                  onChange={(v) => update("supportAngle", v)}
                />
                <p className="slc-note">Overhangs steeper than this from horizontal get automatic support.</p>
              </div>
            ) : null}
            {section === "others" ? (
              <div className="slc-fields">
                <label className={`slc-field ${changed.has("brim") ? "changed" : ""}`}>
                  <span>Brim</span>
                  <input type="checkbox" checked={settings.brim} onChange={(e) => update("brim", e.target.checked)} />
                </label>
              </div>
            ) : null}
          </section>
        </aside>

        <div className="slc-view">
          {view === "printers" ? (
            <PrinterTable current={settings.printer} onPick={(id) => update("printer", id)} />
          ) : null}
          <div className="slc-canvas" ref={hostRef} hidden={view === "printers"} />

          {view !== "printers" ? (
            <>
              <div className="slc-overlay top">
                {view === "preview" && sliced ? (
                  <div className="slc-legend">
                    <table>
                      <thead>
                        <tr>
                          <th>Line type</th>
                          <th>Time</th>
                          <th>Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {legend.map((f) => (
                          <tr key={f.kind} className={hidden.has(f.kind) ? "off" : ""}>
                            <td>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={!hidden.has(f.kind)}
                                  onChange={() =>
                                    setHidden((h) => {
                                      const n = new Set(h);
                                      if (n.has(f.kind)) n.delete(f.kind);
                                      else n.add(f.kind);
                                      return n;
                                    })
                                  }
                                />
                                <span className="sw" style={{ background: f.color }} />
                                {f.label}
                              </label>
                            </td>
                            <td>{formatDuration(f.seconds)}</td>
                            <td>{Math.round(f.share * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="slc-hint">
                    {problems.length ? (
                      problems.map((p) => (
                        <p key={p} className="warn">
                          <AlertTriangle size={14} /> {p}
                        </p>
                      ))
                    ) : (
                      <p>Ready for the {prn.name}. Slice the plate to preview toolpaths.</p>
                    )}
                  </div>
                )}
                <span className="slc-grow" />
                <button type="button" className="slc-icon" aria-label="Reset view" title="Reset view" onClick={() => previewRef.current?.home()}>
                  <Home size={15} />
                </button>
              </div>

              {view === "preview" && sliced && layers > 0 ? (
                <div className="slc-layers">
                  <span className="slc-tag">
                    {layers}
                    <br />
                    {g!.layers[layers - 1].z.toFixed(2)}
                  </span>
                  <div className="slc-vrange">
                    <input
                      type="range"
                      aria-label="Top layer"
                      min={0}
                      max={layers - 1}
                      value={layer}
                      onChange={(e) => {
                        setPlaying(false);
                        setLayer(Number(e.target.value));
                      }}
                    />
                    <span className="slc-tag on">
                      {layer + 1}
                      <br />
                      {g!.layers[Math.min(layer, layers - 1)].z.toFixed(2)}
                    </span>
                  </div>
                  <span className="slc-tag">
                    1<br />
                    {g!.layers[0].z.toFixed(2)}
                  </span>
                </div>
              ) : null}

              <div className="slc-foot">
                {view === "preview" && sliced ? (
                  <>
                    <button
                      type="button"
                      className="slc-icon"
                      aria-label={playing ? "Pause" : "Play layers"}
                      onClick={() => {
                        if (!playing && layer >= layers - 1) setLayer(0);
                        setPlaying((p) => !p);
                      }}
                    >
                      {playing ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <label className="slc-moves">
                      Moves in layer {layer + 1}
                      <input type="range" min={0} max={100} value={moves} onChange={(e) => setMoves(Number(e.target.value))} />
                    </label>
                    <div className="slc-sum">
                      <span>
                        <em>Total</em> {formatDuration(total)}
                        {g!.reportedSeconds === null ? <sup title="Estimated from feed rates; acceleration not included">≈</sup> : null}
                      </span>
                      <span>
                        <em>Filament</em> {grams.toFixed(0)} g · {(g!.filamentMm / 1000).toFixed(2)} m
                      </span>
                      <span>
                        <em>Layers</em> {layers}
                      </span>
                    </div>
                  </>
                ) : (
                  <small>
                    Kiri:Moto slices in this browser; nothing is uploaded.
                  </small>
                )}
              </div>
            </>
          ) : null}

          {error ? (
            <div className="slc-error" role="alert">
              <AlertTriangle size={15} /> {error}
              <button type="button" className="slc-link" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Num(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  changed?: boolean;
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, step = 1, disabled, changed, onChange } = props;
  return (
    <label className={`slc-field ${changed ? "changed" : ""}`}>
      <span>
        {label}
        {changed ? <i title="Changed from the preset" /> : null}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

function PrinterTable({ current, onPick }: { current: PrinterId; onPick: (id: PrinterId) => void }) {
  return (
    <div className="slc-printers">
      <table>
        <thead>
          <tr>
            <th>Printer</th>
            <th>Bed (mm)</th>
            <th>Nozzle (mm)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {PRINTERS.map((p) => (
            <tr key={p.id} className={p.id === current ? "on" : ""}>
              <td>{p.name}</td>
              <td>
                {p.bed.w} × {p.bed.d} × {p.bed.h}
              </td>
              <td>{p.nozzle}</td>
              <td>
                {p.id === current ? (
                  <span className="slc-chip">Selected</span>
                ) : (
                  <button type="button" className="slc-link" onClick={() => onPick(p.id)}>
                    Use
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="slc-note">Printer profiles come from Kiri:Moto. Its G-code starts and ends with each printer's own start and end G-code.</p>
    </div>
  );
}
