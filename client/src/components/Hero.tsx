import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { STAGES, type StageId } from "@/lib/data";

interface HeroProps {
  collapsed: boolean;
  onToggle: () => void;
  stage: StageId | null;
  onStage: (id: StageId) => void;
  onStart: () => void;
}

/**
 * The Idea Forge hero. Expanded, it carries the headline, the call to action and the
 * six-stage pipeline over the concept art. Collapsed, it folds vertically into a single
 * band that keeps the pipeline reachable. The Collapse tab under the hero toggles it.
 */
export function Hero({ collapsed, onToggle, stage, onStage, onStart }: HeroProps) {
  return (
    <section className={collapsed ? "hero collapsed" : "hero"} aria-label="From an idea to a mission-ready solution">
      <div className="hero-body">
        <div className="hero-copy" aria-hidden={collapsed}>
          <h2>
            <span>From an idea</span>
            <em>to a mission-ready solution.</em>
          </h2>
          <p>
            Tap into the Air Force's global innovation ecosystem to collaborate, design, and rapidly prototype
            solutions to real-world challenges. From concept to field, we turn bold ideas into mission-ready
            capability.
          </p>
          <button type="button" className="btn-start" onClick={onStart} tabIndex={collapsed ? -1 : 0}>
            Start My Own Project <ArrowRight size={16} />
          </button>
        </div>

        <div className="hero-band">
          <strong>From an idea <em>to a mission-ready solution.</em></strong>
          <button type="button" className="btn-start sm" onClick={onStart} tabIndex={collapsed ? 0 : -1}>
            Start My Own Project <ArrowRight size={14} />
          </button>
        </div>

        <ol className="pipeline" aria-label="Idea Forge stages">
          {STAGES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={stage === s.id ? "stage on" : "stage"}
                aria-current={stage === s.id ? "step" : undefined}
                onClick={() => onStage(s.id)}
              >
                <span className="stage-num">{s.num}</span>
                <span className="stage-text">
                  <b>{s.title}</b>
                  <small>{s.caption}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        className="collapse-tab"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand the hero" : "Collapse the hero"}
      >
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        <span>{collapsed ? "Expand" : "Collapse"}</span>
      </button>
    </section>
  );
}
