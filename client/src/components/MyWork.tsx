import { Clock, Users } from "lucide-react";
import { STAGES, type Project, type StageId } from "@/lib/data";

interface MyWorkProps {
  projects: Project[];
  owner: string;
  query: string;
  onStage: (id: StageId) => void;
  onStart: () => void;
}

const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!;

/** Work owned by the signed-in person. */
export function MyWork({ projects, owner, query, onStage, onStart }: MyWorkProps) {
  const q = query.trim().toLowerCase();
  const mine = projects.filter((p) => p.owner === owner && (!q || `${p.title} ${p.problem}`.toLowerCase().includes(q)));
  return (
    <div className="stack">
      <section className="panel projects">
        <header>
          <h3>My Work</h3>
          <span>{mine.length}</span>
        </header>
        {mine.length === 0 ? (
          <p className="empty">Nothing is assigned to {owner} yet.</p>
        ) : (
          <ul>
            {mine.map((p) => {
              const s = stageOf(p.stage);
              return (
                <li key={p.id}>
                  <button type="button" className="project" onClick={() => onStage(p.stage)}>
                    <div className="project-top">
                      <b>{p.title}</b>
                      <span className={`tag stage-${p.stage}`}>{s.num} · {s.title}</span>
                    </div>
                    <p>{p.problem}</p>
                    <div className="progress" aria-label={`Stage ${s.num} of ${STAGES.length}`}>
                      {STAGES.map((x) => (
                        <i key={x.id} className={x.num < s.num ? "done" : x.num === s.num ? "now" : ""} />
                      ))}
                    </div>
                    <div className="meta">
                      <span>{p.unit}</span>
                      <span><Users size={12} /> {p.collaborators}</span>
                      <span><Clock size={12} /> {p.updated}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="btn-idea work-start" onClick={onStart}>Start my own project</button>
      </section>
    </div>
  );
}
