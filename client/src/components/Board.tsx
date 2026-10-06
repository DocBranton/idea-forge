import { ArrowRight, Clock, Users } from "lucide-react";
import { CAPABILITIES, CHALLENGES, STAGES, type Project, type StageId } from "@/lib/data";

interface BoardProps {
  projects: Project[];
  query: string;
  onStage: (id: StageId) => void;
  onPing: (msg: string) => void;
}

const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!;

function matches(query: string, ...fields: string[]) {
  const q = query.trim().toLowerCase();
  return !q || fields.join(" ").toLowerCase().includes(q);
}

/** Home: the projects in flight, open challenges, and capabilities to pull on. */
export function Board({ projects, query, onStage, onPing }: BoardProps) {
  const mine = projects.filter((p) => matches(query, p.title, p.problem, p.owner, p.unit, p.stage));
  const challenges = CHALLENGES.filter((c) => matches(query, c.title, c.sponsor, ...c.tags));
  const capabilities = CAPABILITIES.filter((k) => matches(query, k.name, k.where, k.kind));

  return (
    <div className="board">
      <section className="panel projects" id="projects">
        <header>
          <h3>Projects in flight</h3>
          <span>{mine.length}</span>
        </header>
        {mine.length === 0 ? (
          <p className="empty">No projects match “{query}”.</p>
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
                      <span>{p.owner} · {p.unit}</span>
                      <span><Users size={12} /> {p.collaborators}</span>
                      <span><Clock size={12} /> {p.updated}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="board-side">
        <section className="panel" id="challenges">
          <header>
            <h3>Open challenges</h3>
            <span>{challenges.length}</span>
          </header>
          {challenges.length === 0 ? (
            <p className="empty">No challenges match.</p>
          ) : (
            <ul className="rows">
              {challenges.map((c) => (
                <li key={c.id}>
                  <button type="button" className="row" onClick={() => onPing(`${c.title}: responses open until ${c.closes}`)}>
                    <div>
                      <b>{c.title}</b>
                      <small>{c.sponsor} · closes {c.closes}</small>
                    </div>
                    <ArrowRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" id="capabilities">
          <header>
            <h3>Capability network</h3>
            <span>{capabilities.length}</span>
          </header>
          {capabilities.length === 0 ? (
            <p className="empty">No capabilities match.</p>
          ) : (
            <ul className="rows">
              {capabilities.map((k) => (
                <li key={k.id} className="row static">
                  <div>
                    <b>{k.name}</b>
                    <small>{k.where}</small>
                  </div>
                  <span className="tag">{k.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
