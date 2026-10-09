import { Clock, Users } from "lucide-react";
import { STAGES, type Project, type StageId } from "@/lib/data";
import { Communities } from "./Communities";
import { Challenges } from "./Challenges";

interface CommunityProps {
  projects: Project[];
  query: string;
  onStage: (id: StageId) => void;
  onPing: (msg: string) => void;
}

const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!;

/** People and shared work across the forge, not the signed-in user's own queue. */
export function Community({ projects, query, onStage, onPing }: CommunityProps) {
  const q = query.trim().toLowerCase();
  const shared = projects.filter((p) => !q || `${p.title} ${p.owner} ${p.unit} ${p.problem}`.toLowerCase().includes(q));
  const people = new Map<string, { unit: string; count: number }>();
  for (const project of projects) {
    const current = people.get(project.owner) ?? { unit: project.unit, count: 0 };
    current.count += 1;
    people.set(project.owner, current);
  }
  return (
    <div className="stack">
      <Communities query={query} expanded onExpand={() => onPing("Showing all communities.")} onOpen={(name) => onPing(`${name} community.`)} />
      <Challenges query={query} expanded onExpand={() => onPing("Showing featured challenges.")} onOpen={(title) => onPing(`${title} is open for submissions.`)} />
      <section className="panel">
        <header>
          <h3>Community</h3>
          <span>{people.size} people</span>
        </header>
        <ul className="rows">
          {[...people.entries()].map(([name, info]) => (
            <li key={name} className="row static">
              <div>
                <b>{name}</b>
                <small>{info.unit}</small>
              </div>
              <span className="tag"><Users size={12} /> {info.count}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel projects">
        <header>
          <h3>Shared work</h3>
          <span>{shared.length}</span>
        </header>
        {shared.length === 0 ? (
          <p className="empty">No shared work matches.</p>
        ) : (
          <ul>
            {shared.map((p) => {
              const s = stageOf(p.stage);
              return (
                <li key={p.id}>
                  <button type="button" className="project" onClick={() => onStage(p.stage)}>
                    <div className="project-top">
                      <b>{p.title}</b>
                      <span className={`tag stage-${p.stage}`}>{s.num} · {s.title}</span>
                    </div>
                    <p>{p.problem}</p>
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
    </div>
  );
}
