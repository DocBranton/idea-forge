import { lazy, Suspense } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { STAGES, type Project, type StageId } from "@/lib/data";

// The CAD engine is UMW's, unchanged. three.js and the OpenCascade worker load only
// when a Design or Validate stage opens.
const CadWorkspace = lazy(() => import("@/cad/CadWorkspace"));

interface StageViewProps {
  stage: StageId;
  projects: Project[];
  onStage: (id: StageId) => void;
  onHome: () => void;
  onPing: (msg: string) => void;
}

export function StageView({ stage, projects, onStage, onHome, onPing }: StageViewProps) {
  const index = STAGES.findIndex((s) => s.id === stage);
  const s = STAGES[index];
  const prev = STAGES[index - 1];
  const next = STAGES[index + 1];
  const here = projects.filter((p) => p.stage === stage);
  const cad = stage === "design" || stage === "validate";

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
