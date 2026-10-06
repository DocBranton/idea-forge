import { useEffect, useRef, useState, type FormEvent } from "react";
import { Lightbulb, X } from "lucide-react";

export interface IdeaDraft {
  title: string;
  problem: string;
}

interface IdeaModalProps {
  mode: "idea" | "project";
  onClose: () => void;
  onSubmit: (draft: IdeaDraft) => void;
}

/** One form for "Submit an idea" and "Start My Own Project". Both begin at Define. */
export function IdeaModal({ mode, onClose, onSubmit }: IdeaModalProps) {
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !problem.trim()) return;
    onSubmit({ title: title.trim(), problem: problem.trim() });
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="idea-h" onSubmit={submit}>
        <header>
          <h3 id="idea-h">
            <Lightbulb size={16} /> {mode === "idea" ? "Submit an idea" : "Start my own project"}
          </h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label>
          <span>Name it</span>
          <input ref={first} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quick-swap sensor mount for Group 2 UAS" />
        </label>
        <label>
          <span>What problem does it solve, and for whom?</span>
          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={4}
            placeholder="Swapping payloads takes 40 minutes and a toolkit on the flight line."
          />
        </label>
        <p className="note">It starts at Define. You can bring in collaborators at Discover.</p>
        <footer>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-idea" disabled={!title.trim() || !problem.trim()}>
            {mode === "idea" ? "Submit idea" : "Start project"}
          </button>
        </footer>
      </form>
    </div>
  );
}
