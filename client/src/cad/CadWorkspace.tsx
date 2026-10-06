// Verified CAD workspace: a React shell around the imperative CAD viewer.
// Loaded lazily (three.js and the OpenCascade worker are only fetched when it opens).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Download,
  Expand,
  Eye,
  Focus,
  Hand,
  Maximize,
  MousePointer2,
  Rotate3d,
  Ruler,
  Scissors,
  Tag,
  Upload,
  ZoomIn,
} from "lucide-react";
import { Viewer, type Axis, type DisplayMode, type Look, type MeasureResult, type PickMode, type Selection, type Tool, type ViewName } from "./engine/viewer";
import { analyzePart, newCounters } from "./engine/analysis";
import { buildSampleBracket } from "./engine/sample";
import { loadCadFile } from "./engine/loaders";
import { Units, type DisplayUnit } from "./engine/units";
import type { ModelData } from "./engine/types";
import { CadTree } from "./CadTree";
import { CadDetails } from "./CadDetails";
import { MATERIALS } from "./labels";
import { applyAction, emptySession, featureKey, geometryHash, modelKey, type CadAction, type CadSession, type FeatureKey } from "./links";
import "./cad.css";

export interface CadWorkspaceProps {
  /** A CAD file from the evidence package to open. Without one, the built-in sample loads. */
  file?: File | null;
  /** Preview mode: viewport only, for the Overview "3D Model" tab. */
  compact?: boolean;
  onPing?: (msg: string) => void;
  /** Compact mode: open the full Verified CAD workspace. */
  onOpenFull?: () => void;
  /** Shown in the generated drawing's title block. */
  partNumber?: string;
  rev?: string;
  /** Requirements a feature can be linked to. Without them, linking is hidden. */
  requirements?: readonly LinkableRequirement[];
  /** Reviews and requirement links for the loaded model. Controlled when given with onAction. */
  session?: CadSession;
  /**
   * Receives each engineer action (review or link change). Resolves true once the
   * change is recorded; the owner reports failures.
   */
  onAction?: (action: CadAction) => Promise<boolean>;
  /** Where reviews are kept, shown in the model summary (e.g. "Saved in this browser only"). */
  storageNote?: string;
  /** Called once a model is analyzed, with its key and recognized features. */
  onModelLoaded?: (info: { key: string; name: string; features: FeatureKey[] }) => void;
  /** Select and frame this feature once it exists. A new nonce re-applies it. */
  focus?: { key: FeatureKey; nonce: number } | null;
}

export interface LinkableRequirement {
  id: string;
  name: string;
  value: string;
  status: string;
}

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: "select", label: "Select", key: "s", Icon: MousePointer2 },
  { id: "pan", label: "Pan", key: "p", Icon: Hand },
  { id: "rotate", label: "Rotate", key: "r", Icon: Rotate3d },
  { id: "zoom", label: "Zoom", key: "z", Icon: ZoomIn },
  { id: "measure", label: "Measure", key: "m", Icon: Ruler },
];
const VIEWS: ViewName[] = ["iso", "front", "back", "top", "bottom", "left", "right"];

export default function CadWorkspace({
  file,
  compact = false,
  onPing,
  onOpenFull,
  partNumber,
  rev: partRev,
  requirements,
  session: sessionProp,
  onAction,
  onModelLoaded,
  focus,
  storageNote,
}: CadWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const triadRef = useRef<SVGSVGElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const units = useMemo(() => new Units("in", 25.4), []);
  const loadSeq = useRef(0);

  const [model, setModel] = useState<ModelData | null>(null);
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tool, setToolState] = useState<Tool>("select");
  const [pick, setPick] = useState<PickMode>("part");
  const [panel, setPanel] = useState<"section" | "explode" | null>(null);
  const [measure, setMeasure] = useState<{ count: number; result: MeasureResult | null; firstFace?: string } | null>(null);
  const [localSession, setLocalSession] = useState<CadSession>(emptySession);
  const session = sessionProp ?? localSession;
  const act = async (a: CadAction): Promise<boolean> => {
    if (onAction) return onAction(a);
    setLocalSession((cur) => applyAction(cur, a));
    return true;
  };
  const [materialIdx, setMaterialIdx] = useState(0);
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("in");
  const [mode, setMode] = useState<"3d" | "drawing">("3d");
  const [sheet, setSheet] = useState<{ url: string; canvas: HTMLCanvasElement } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const drawingMod = useRef<typeof import("./engine/drawing-render") | null>(null);
  // Parents pass a new onPing on every render. Read it through a ref so a parent
  // re-render (a toast, a review) never re-runs the load effect and reloads the sample.
  const onPingRef = useRef(onPing);
  onPingRef.current = onPing;
  const ping = useCallback((m: string) => onPingRef.current?.(m), []);
  const onModelLoadedRef = useRef(onModelLoaded);
  onModelLoadedRef.current = onModelLoaded;

  // Create the viewer once per mount.
  useEffect(() => {
    if (!hostRef.current || !labelsRef.current) return;
    const v = new Viewer({ host: hostRef.current, labels: labelsRef.current, units, viewcube: compact ? null : cubeRef.current, triad: compact ? null : triadRef.current });
    viewerRef.current = v;
    // The preview is small; dimensions would crowd it.
    if (compact) v.setAnnotations(false);
    const onSelect = (e: Event) => setSelection((e as CustomEvent<Selection | null>).detail);
    const onMeasure = (e: Event) => {
      const d = (e as CustomEvent<{ points: { face?: { type: string; radius?: number } }[]; result: MeasureResult | null } | null>).detail;
      if (!d) return setMeasure(null);
      const f = d.points[0]?.face;
      setMeasure({ count: d.points.length, result: d.result, firstFace: f && f.type === "cylinder" && f.radius ? units.dia(f.radius) : undefined });
    };
    v.addEventListener("select", onSelect);
    v.addEventListener("measure", onMeasure);
    v.addEventListener("visibility", bump);
    v.addEventListener("section", bump);
    v.addEventListener("explode", bump);
    return () => {
      v.removeEventListener("select", onSelect);
      v.removeEventListener("measure", onMeasure);
      v.removeEventListener("visibility", bump);
      v.removeEventListener("section", bump);
      v.removeEventListener("explode", bump);
      v.dispose();
      viewerRef.current = null;
    };
  }, [compact, units, bump]);

  const openModel = useCallback(
    async (m: ModelData) => {
      const v = viewerRef.current;
      if (!v) return;
      const seq = ++loadSeq.current;
      units.mmPerUnit = m.mmPerUnit;
      const unit: DisplayUnit = m.mmPerUnit === 25.4 ? "in" : "mm";
      units.display = unit;
      setDisplayUnit(unit);
      v.setModel(m);
      setModel(m);
      setSelection(null);
      setLocalSession(emptySession());
      setError(null);
      bump();
      // Analyze part by part so the page stays responsive.
      const counters = newCounters();
      const t0 = performance.now();
      for (const p of v.parts) {
        if (seq !== loadSeq.current) return;
        setStatus(`Analyzing ${p.index + 1} of ${v.parts.length}: ${p.name}`);
        await new Promise((r) => setTimeout(r, 0));
        try {
          p.data = analyzePart(p.src, counters);
        } catch (err) {
          console.error(err);
        }
      }
      if (seq !== loadSeq.current) return;
      const n = v.parts.reduce((s, p) => s + (p.data?.features.length ?? 0), 0);
      setStatus(`${n} features recognized in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      v.refreshAnnotations();
      bump();
      const triangles = m.meshes.reduce((t, mesh) => t + mesh.index.length / 3, 0);
      onModelLoadedRef.current?.({
        key: modelKey(m.fileName, m.meshes.length, triangles, geometryHash(m.meshes.flatMap((mesh) => [mesh.position, mesh.index]))),
        name: m.name,
        features: v.parts.flatMap((p) => (p.data?.features ?? []).map((f) => featureKey(p.name, f.name))),
      });
    },
    [units, bump],
  );

  const openFile = useCallback(
    async (f: File) => {
      setLoading(`Reading ${f.name}`);
      setError(null);
      try {
        const m = await loadCadFile(f, (msg) => setLoading(msg));
        await openModel(m);
        ping(`Opened ${f.name}: ${m.meshes.length} part${m.meshes.length === 1 ? "" : "s"}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(null);
      }
    },
    [openModel, ping],
  );

  // Open the provided file, or the sample.
  useEffect(() => {
    if (!viewerRef.current) return;
    if (file) void openFile(file);
    else void openModel(buildSampleBracket());
  }, [file, openFile, openModel]);

  // Select a requested feature once analysis has produced it.
  const appliedFocus = useRef<number | null>(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!focus || !viewer || appliedFocus.current === focus.nonce) return;
    for (const p of viewer.parts) {
      const f = p.data?.features.find((x) => featureKey(p.name, x.name) === focus.key);
      if (!f) continue;
      appliedFocus.current = focus.nonce;
      setMode("3d");
      viewer.select({ kind: "feature", part: p.index, feature: f.name });
      viewer.fitToSelection = true;
      viewer.fit(true);
      return;
    }
  }, [focus, rev]);

  // Generated drawing: rebuilt from what the viewer shows whenever it changes.
  useEffect(() => {
    if (mode !== "drawing" || !model) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      try {
        drawingMod.current ??= await import("./engine/drawing-render");
        if (cancelled) return;
        const canvas = drawingMod.current.generateDrawing(viewer, units, {
          title: model.name,
          partNumber,
          rev: partRev,
          material: MATERIALS[materialIdx].name,
        });
        setSheet({ url: canvas.toDataURL("image/png"), canvas });
        setSheetError(null);
      } catch (err) {
        setSheetError(err instanceof Error ? err.message : String(err));
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, model, rev, displayUnit, materialIdx, partNumber, partRev, units]);

  // Release the drawing's offscreen WebGL context with the workspace.
  useEffect(() => () => drawingMod.current?.disposeDrawingRenderer(), []);

  const downloadSheet = () => {
    if (!sheet || !model) return;
    sheet.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${model.name.replace(/[^\w.-]+/g, "_")}-drawing.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };

  const v = viewerRef.current;
  const setTool = (t: Tool) => {
    v?.setTool(t);
    setToolState(t);
    setMeasure(t === "measure" ? { count: 0, result: null } : null);
  };
  const selectedParts = (): number[] => (!selection ? [] : selection.kind === "assembly" ? selection.parts : [selection.part]);
  const select = (s: Selection) => v?.select(s);
  const fitSelection = () => {
    if (!v) return;
    v.fitToSelection = !!v.selection;
    v.fit(true);
  };
  const hideOrShow = () => {
    if (!v) return;
    const sp = selectedParts();
    if (sp.length) {
      v.setVisible(sp, false);
      ping("Hidden. Use Show/Hide with nothing selected to show all.");
    } else if (v.parts.some((p) => !p.visible)) v.setVisible(v.parts.map((p) => p.index), true);
  };
  const isolate = () => {
    if (!v) return;
    if (!v.isolated && !selectedParts().length) {
      ping("Select a part or assembly to isolate it.");
      return;
    }
    v.isolate(selectedParts());
    v.fit(true);
    bump();
  };
  const changeUnits = (u: DisplayUnit) => {
    units.display = u;
    setDisplayUnit(u);
    v?.refreshAnnotations();
    bump();
  };

  // Keyboard shortcuts while the pointer is over the workspace.
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey || compact) return;
    const k = e.key.toLowerCase();
    const t = TOOLS.find((x) => x.key === k);
    if (t) return setTool(t.id);
    if (k === "f") return fitSelection();
    if (k === "h") return hideOrShow();
    if (k === "i") return isolate();
    if (k === "a" && v) {
      v.setAnnotations(!v.annotations);
      return bump();
    }
    if (/^[1-7]$/.test(k)) return v?.setView(VIEWS[Number(k) - 1]);
    if (k === "escape") {
      v?.clearMeasure();
      v?.clearSelection();
      setPanel(null);
    }
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      hidden
      accept=".step,.stp,.iges,.igs,.brep,.brp,.stl,.obj,.glb,.gltf"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void openFile(f);
      }}
    />
  );

  const viewport = (
    <div
      className="cad-viewport"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void openFile(f);
      }}
    >
      <div ref={hostRef} className="cad-host" />
      <div ref={labelsRef} className="cad-labels" />
      {!compact ? <div ref={cubeRef} className="cad-cube" title="Click a face to snap the view" /> : null}
      {!compact ? <svg ref={triadRef} className="cad-triad" viewBox="0 0 90 90" aria-hidden="true" /> : null}
      {loading ? (
        <div className="cad-overlay">
          <div className="cad-spinner" />
          <span>{loading}</span>
        </div>
      ) : null}
      {error ? (
        <div className="cad-error" role="alert">
          <strong>File not opened.</strong> {error}
          <button type="button" className="cad-link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {measure ? (
        <div className="cad-readout">
          {!measure.result ? (
            <span>
              {measure.count === 0 ? "Pick the first point" : "Pick the second point"}
              {measure.firstFace ? ` · first face ${measure.firstFace}` : ""}
            </span>
          ) : (
            <>
              <span>
                Distance <b>{units.len(measure.result.distance)}</b>
              </span>
              <span>ΔX {units.len(Math.abs(measure.result.delta.x), false)}</span>
              <span>ΔY {units.len(Math.abs(measure.result.delta.y), false)}</span>
              <span>ΔZ {units.len(Math.abs(measure.result.delta.z), false)}</span>
              {measure.result.planeGap != null ? (
                <span>
                  Face gap <b>{units.len(measure.result.planeGap)}</b>
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {model && !compact ? (
        <div className="cad-status">
          <span>{model.fileName}</span>
          <span>{v?.parts.length ?? 0} parts</span>
          <span>{status}</span>
        </div>
      ) : null}
      {mode === "drawing" && !compact ? (
        <div className="cad-sheet">
          <div className="cad-sheet-bar">
            <span className="muted">
              Third-angle projection of the visible geometry. Hide parts, explode or section in 3D to change it. Generated from CAD, not a released drawing.
            </span>
            <button type="button" className="action" disabled={!sheet} onClick={downloadSheet}>
              <Download size={14} /> Download PNG
            </button>
          </div>
          {sheetError ? (
            <p className="cad-error" role="alert">
              The drawing could not be generated: {sheetError}
            </p>
          ) : sheet ? (
            <img className="cad-sheet-img" src={sheet.url} alt={`Generated drawing of ${model?.name ?? "the model"}`} />
          ) : (
            <div className="cad-overlay">
              <div className="cad-spinner" />
              <span>Generating drawing</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <div className="cadws compact">
        {viewport}
        <div className="cad-compact-bar">
          <span>{model ? `${model.name} · drag to orbit` : "Loading model"}</span>
          {onOpenFull ? (
            <button type="button" className="action" onClick={onOpenFull}>
              Open in Verified CAD
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="cadws" tabIndex={-1} onKeyDown={onKeyDown}>
      {fileInput}
      <div className="cad-bar" role="toolbar" aria-label="CAD tools">
        <div className="ec-seg cad-seg" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={mode === "3d"} className={mode === "3d" ? "on" : ""} onClick={() => setMode("3d")}>
            3D
          </button>
          <button type="button" role="radio" aria-checked={mode === "drawing"} className={mode === "drawing" ? "on" : ""} onClick={() => setMode("drawing")}>
            Drawing
          </button>
        </div>
        <span className="cad-sep" />
        {TOOLS.map(({ id, label, key, Icon }) => (
          <button key={id} type="button" className={`cad-tool${tool === id ? " on" : ""}`} title={`${label} (${key.toUpperCase()})`} onClick={() => setTool(id)}>
            <Icon size={16} />
            {label}
          </button>
        ))}
        <span className="cad-sep" />
        <button type="button" className="cad-tool" title="Fit (F)" onClick={fitSelection}>
          <Maximize size={16} />
          Fit
        </button>
        <button
          type="button"
          className={`cad-tool${v?.section.enabled ? " on" : ""}`}
          title="Section plane"
          onClick={() => {
            if (!v?.section.enabled) v?.setSection({ enabled: true });
            setPanel(panel === "section" ? null : "section");
          }}
        >
          <Scissors size={16} />
          Section
        </button>
        <button type="button" className={`cad-tool${(v?.explode ?? 0) > 0 ? " on" : ""}`} title="Explode" onClick={() => setPanel(panel === "explode" ? null : "explode")}>
          <Expand size={16} />
          Explode
        </button>
        <button type="button" className="cad-tool" title="Hide selection, or show all (H)" onClick={hideOrShow}>
          <Eye size={16} />
          Show/Hide
        </button>
        <button type="button" className={`cad-tool${v?.isolated ? " on" : ""}`} title="Isolate selection (I)" onClick={isolate}>
          <Focus size={16} />
          Isolate
        </button>
        <button
          type="button"
          className={`cad-tool${v?.annotations ? " on" : ""}`}
          title="Annotations (A)"
          onClick={() => {
            v?.setAnnotations(!v.annotations);
            bump();
          }}
        >
          <Tag size={16} />
          Dimensions
        </button>
        <span className="cad-sep" />
        <select className="cad-select" aria-label="Standard view" value="" onChange={(e) => e.target.value && v?.setView(e.target.value as ViewName)}>
          <option value="">View…</option>
          {VIEWS.map((n, i) => (
            <option key={n} value={n}>
              {n[0].toUpperCase() + n.slice(1)} ({i + 1})
            </option>
          ))}
        </select>
        <select className="cad-select" aria-label="Display mode" defaultValue="shaded-edges" onChange={(e) => v?.setDisplayMode(e.target.value as DisplayMode)}>
          <option value="shaded-edges">Shaded + edges</option>
          <option value="shaded">Shaded</option>
          <option value="wireframe">Wireframe</option>
          <option value="xray">X-ray</option>
        </select>
        <select className="cad-select" aria-label="Material look" defaultValue="titanium" onChange={(e) => v?.setLook(e.target.value as Look)}>
          <option value="titanium">Titanium</option>
          <option value="aluminum">Aluminum</option>
          <option value="steel">Dark steel</option>
          <option value="original">File colors</option>
        </select>
        <span className="cad-grow" />
        <div className="ec-seg cad-seg" role="radiogroup" aria-label="Pick">
          {(["part", "feature", "face"] as PickMode[]).map((p) => (
            <button
              key={p}
              type="button"
              className={pick === p ? "on" : ""}
              onClick={() => {
                setPick(p);
                if (v) v.pick = p;
              }}
            >
              {p === "part" ? "Parts" : p === "feature" ? "Features" : "Faces"}
            </button>
          ))}
        </div>
        <div className="ec-seg cad-seg" role="radiogroup" aria-label="Units">
          {(["in", "mm"] as DisplayUnit[]).map((u) => (
            <button key={u} type="button" className={displayUnit === u ? "on" : ""} onClick={() => changeUnits(u)}>
              {u}
            </button>
          ))}
        </div>
        <button type="button" className="action" onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> Open CAD file
        </button>
        {model && !model.sample ? (
          <button type="button" className="action" onClick={() => void openModel(buildSampleBracket())}>
            Sample
          </button>
        ) : null}
      </div>

      {panel === "section" && v ? (
        <div className="cad-strip">
          <span>Section plane</span>
          <div className="ec-seg cad-seg">
            {(["x", "y", "z"] as Axis[]).map((a) => (
              <button key={a} type="button" className={v.section.axis === a ? "on" : ""} onClick={() => v.setSection({ enabled: true, axis: a })}>
                {a.toUpperCase()}
              </button>
            ))}
          </div>
          <input type="range" min={0} max={1} step={0.001} value={v.section.t} aria-label="Section offset" onChange={(e) => v.setSection({ enabled: true, t: Number(e.target.value) })} />
          <span className="cad-num">
            {v.section.axis.toUpperCase()} = {units.len(v.sectionValue)}
          </span>
          <button type="button" className="cad-link" onClick={() => v.setSection({ flip: !v.section.flip })}>
            Flip side
          </button>
          <button
            type="button"
            className="cad-link"
            onClick={() => {
              v.setSection({ enabled: false });
              setPanel(null);
            }}
          >
            Turn off
          </button>
        </div>
      ) : null}
      {panel === "explode" && v ? (
        <div className="cad-strip">
          <span>Explode</span>
          <input type="range" min={0} max={1} step={0.01} value={v.explode} aria-label="Explode amount" onChange={(e) => v.setExplode(Number(e.target.value))} />
          <span className="cad-num">{Math.round(v.explode * 100)}%</span>
          <button type="button" className="cad-link" onClick={() => v.setExplode(0)}>
            Collapse
          </button>
        </div>
      ) : null}

      <div className="cad-main">
        <aside className="cad-side">
          {model && v ? (
            <CadTree
              model={model}
              parts={v.parts}
              units={units}
              selection={selection}
              reviews={session.reviews}
              links={session.links}
              rev={rev}
              onSelect={select}
              onFit={fitSelection}
              onVisibility={(ps, show) => v.setVisible(ps, show)}
            />
          ) : null}
        </aside>
        {viewport}
        <aside className="cad-side right">
          {model && v ? (
            <CadDetails
              model={model}
              parts={v.parts}
              units={units}
              selection={selection}
              featureOf={(s) => v.featureOf(s)}
              reviews={session.reviews}
              onReview={(key, st) => {
                void act({ kind: "review", feature: key, to: st }).then((ok) => ok && ping(`${key.split("#")[1]} marked ${st.toLowerCase()}`));
              }}
              requirements={requirements}
              session={session}
              onLink={(key, req, add) => void act({ kind: add ? "link" : "unlink", feature: key, requirement: req })}
              storageNote={storageNote}
              materialIdx={materialIdx}
              onMaterial={setMaterialIdx}
              onSelect={select}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
