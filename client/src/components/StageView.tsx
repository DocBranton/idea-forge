import { lazy, Suspense, useEffect } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { STAGES, type Project, type StageId } from "@/lib/data";

// The CAD engine is UMW's, unchanged. three.js and the OpenCascade worker load only
// when a Design or Validate stage opens.
const CadWorkspace = lazy(() => import("@/cad/CadWorkspace"));
// The slicer for Produce: Kiri:Moto, in the browser.
const SlicerWorkspace = lazy(() => import("@/slicer/SlicerWorkspace"));

interface StageViewProps {
  stage: StageId;
  projects: Project[];
  onStage: (id: StageId) => void;
  onHome: () => void;
  onPing: (msg: string) => void;
  /** Id of a panel on this stage to scroll to after it renders. */
  focusPanel?: string | null;
  onFocused?: () => void;
}

export function StageView({ stage, projects, onStage, onHome, onPing, focusPanel, onFocused }: StageViewProps) {
  useEffect(() => {
    if (!focusPanel) return;
    document.getElementById(focusPanel)?.scrollIntoView({ block: "start" });
    onFocused?.();
  }, [focusPanel, onFocused]);

  const index = STAGES.findIndex((s) => s.id === stage);
  const s = STAGES[index];
  const prev = STAGES[index - 1];
  const next = STAGES[index + 1];
  const here = projects.filter((p) => p.stage === stage);
  const cad = stage === "design" || stage === "validate";
  const produce = stage === "produce";

  return (
    <div className="stage-view">
      <header className="stage-head">
        <img src={s.image} alt="" />
        <div>
          <span className="eyebrow">Stage {s.num} of {STAGES.length}</span>
          <h2>{s.title} <small>{s.caption}</small></h2>
          <p>{s.summary}</p>
          <span className="cap-line">Carried by: {s.capability}</span>
        </div>
        <nav className="stage-step" aria-label="Stages">
          <button type="button" onClick={() => (prev ? onStage(prev.id) : onHome())}>
            <ArrowLeft size={14} /> {prev ? prev.title : "Home"}
          </button>
          {next ? (
            <button type="button" onClick={() => onStage(next.id)}>
              {next.title} <ArrowRight size={14} />
            </button>
          ) : null}
        </nav>
      </header>

      {cad ? (
        <section className="panel cad-panel">
          <header>
            <h3>{stage === "design" ? "Design studio" : "Feature validation"}</h3>
            <span>
              {stage === "design"
                ? "Open a STEP, IGES, BREP, STL, OBJ or glTF file. Files stay in your browser."
                : "Validate or reject recognized features. Each decision is kept with who made it."}
            </span>
          </header>
          <div className="cad-host">
            <Suspense fallback={<p className="empty">Loading the CAD workspace…</p>}>
              <CadWorkspace onPing={onPing} partNumber="IF-0001" rev="A" storageNote="Saved in this browser only" />
            </Suspense>
          </div>
        </section>
      ) : produce ? (
        <section className="panel cad-panel" id="print-prep">
          <header>
            <h3>Print prep</h3>
            <span>Slice the part from Design or Validate for a 3D printer. Slicing runs in your browser.</span>
          </header>
          <div className="slc-host">
            <Suspense fallback={<p className="empty">Loading the slicer…</p>}>
              <SlicerWorkspace onPing={onPing} />
            </Suspense>
          </div>
        </section>
      ) : (
        <section className="panel">
          <header>
            <h3>Projects at {s.title}</h3>
            <span>{here.length}</span>
          </header>
          {here.length === 0 ? (
            <p className="empty">No projects are at this stage yet.</p>
          ) : (
            <ul className="rows">
              {here.map((p) => (
                <li key={p.id} className="row static">
                  <div>
                    <b>{p.title}</b>
                    <small>{p.problem}</small>
                  </div>
                  <span className="tag">{p.owner}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="note">This stage is in the concept. Its working tools land in a later slice.</p>
        </section>
      )}
    </div>
  );
}
