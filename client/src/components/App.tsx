import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Boxes,
  ChevronDown,
  ChevronLeft,
  Cog,
  FolderKanban,
  House,
  Lightbulb,
  Menu,
  PenTool,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { Hero } from "./Hero";
import { Board } from "./Board";
import { StageView } from "./StageView";
import { IdeaModal, type IdeaDraft } from "./IdeaModal";
import { PROJECTS, type Project, type StageId } from "@/lib/data";

const HERO_KEY = "foundry-hero-collapsed";

// Browser storage is a per-viewer convenience here; the page works without it.
function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* private window or blocked storage */
  }
}

interface Me {
  name: string;
  org: string;
  initials: string;
}

// The concept's persona, shown until the Databricks Apps sign-in says otherwise.
const CONCEPT_USER: Me = { name: "Capt. T. Anderson", org: "U.S. Air Force", initials: "TA" };

function personFrom(email: string | null, id: string): Me {
  const handle = (email ?? id).split("@")[0];
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ") || handle;
  const initials = (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
  return { name, org: "U.S. Air Force", initials: initials.toUpperCase() };
}

type View = { kind: "home" } | { kind: "stage"; stage: StageId };

export function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [history, setHistory] = useState<View[]>([]);
  const [collapsed, setCollapsed] = useState(() => readFlag(HERO_KEY));
  const [projects, setProjects] = useState<Project[]>(PROJECTS);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"idea" | "project" | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [me, setMe] = useState<Me>(CONCEPT_USER);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u: { id: string; email: string | null } | null) => {
        if (u && u.id !== "local-dev") setMe(personFrom(u.email, u.id));
      })
      .catch(() => {});
  }, []);

  const ping = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  function toggleHero() {
    setCollapsed((c) => {
      writeFlag(HERO_KEY, !c);
      return !c;
    });
  }

  function navigate(next: View) {
    setNavOpen(false);
    setHistory((h) => [...h, view]);
    setView(next);
  }

  function back() {
    setView(history[history.length - 1] ?? { kind: "home" });
    setHistory(history.slice(0, -1));
  }

  function goHomeSection(id: string) {
    navigate({ kind: "home" });
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function addIdea(draft: IdeaDraft) {
    const project: Project = {
      id: `p-${Date.now()}`,
      title: draft.title,
      problem: draft.problem,
      owner: me.name,
      unit: me.org,
      stage: "define",
      updated: "Just now",
      collaborators: 1,
    };
    setProjects((list) => [project, ...list]);
    setModal(null);
    setQuery("");
    navigate({ kind: "home" });
    ping(`“${draft.title}” is in Define.`);
  }

  const stage = view.kind === "stage" ? view.stage : null;
  const navItems: { id: string; label: string; Icon: typeof House; on: boolean; go: () => void }[] = [
    { id: "home", label: "Home", Icon: House, on: view.kind === "home", go: () => navigate({ kind: "home" }) },
    { id: "projects", label: "My Projects", Icon: FolderKanban, on: false, go: () => goHomeSection("projects") },
    { id: "challenges", label: "Challenges", Icon: Target, on: false, go: () => goHomeSection("challenges") },
    { id: "capabilities", label: "Capabilities", Icon: Boxes, on: false, go: () => goHomeSection("capabilities") },
  ];
  const toolItems = [
    { id: "design", label: "Design Studio", Icon: PenTool, on: stage === "design", go: () => navigate({ kind: "stage", stage: "design" }) },
    { id: "validate", label: "Feature Validation", Icon: ShieldCheck, on: stage === "validate", go: () => navigate({ kind: "stage", stage: "validate" }) },
  ];

  return (
    <div className={navOpen ? "app nav-open" : "app"}>
      <button className="nav-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="usaf">
          <img src="/brand/usaf-lockup.png" alt="U.S. Air Force" />
        </div>
        <div className="foundry-mark">
          <Cog className="gear" strokeWidth={2.4} aria-hidden="true" />
          <div className="wordmark">
            <span>Idea</span>
            <em>Forge</em>
          </div>
        </div>
        <p className="tagline">Turning bold ideas<br />into mission-ready capabilities</p>

        <div className="nav-label">Workspace</div>
        <nav className="nav-list">
          {navItems.map(({ id, label, Icon, on, go }) => (
            <button key={id} type="button" className={on ? "nav-item on" : "nav-item"} onClick={go}>
              <Icon size={17} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-label">Tools</div>
        <nav className="nav-list">
          {toolItems.map(({ id, label, Icon, on, go }) => (
            <button key={id} type="button" className={on ? "nav-item on" : "nav-item"} onClick={go}>
              <Icon size={17} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">Built on the Unified Mission Workbench</div>
      </aside>

      <main className={collapsed ? "main hero-collapsed" : "main"}>
        <div className="stage-art" aria-hidden="true" />
        <header className="topbar">
          <button type="button" className="icon-btn mob-toggle" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Menu size={18} />
          </button>
          <button type="button" className="icon-btn back" aria-label="Back" disabled={history.length === 0} onClick={back}>
            <ChevronLeft size={20} />
          </button>
          <label className="search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (view.kind !== "home") setView({ kind: "home" });
              }}
              aria-label="Search"
              placeholder="Search projects, people, capabilities, opportunities, or ideas…"
            />
            <button type="button" className="filter" aria-label="Filters" onClick={() => ping("Filters arrive with live data.")}>
              <SlidersHorizontal size={16} />
            </button>
          </label>
          <div className="top-actions">
            <button type="button" className="btn-idea" onClick={() => setModal("idea")}>
              <Lightbulb size={17} /> <span>Submit an idea</span>
            </button>
            <button type="button" className="icon-btn bell" aria-label="Notifications" onClick={() => ping("Nothing is waiting on you.")}>
              <Bell size={20} />
            </button>
            <button type="button" className="user" onClick={() => ping(`Signed in as ${me.name}`)}>
              <span className="avatar">{me.initials}</span>
              <span className="user-meta">
                <strong>{me.name}</strong>
                <span>{me.org}</span>
              </span>
              <ChevronDown size={16} />
            </button>
          </div>
        </header>

        <Hero
          collapsed={collapsed}
          onToggle={toggleHero}
          stage={stage}
          onStage={(id) => navigate({ kind: "stage", stage: id })}
          onStart={() => setModal("project")}
        />

        <div className="workspace">
          {view.kind === "stage" ? (
            <StageView
              key={view.stage}
              stage={view.stage}
              projects={projects}
              onStage={(id) => navigate({ kind: "stage", stage: id })}
              onHome={() => navigate({ kind: "home" })}
              onPing={ping}
            />
          ) : (
            <Board projects={projects} query={query} onStage={(id) => navigate({ kind: "stage", stage: id })} onPing={ping} />
          )}
        </div>
      </main>

      {modal ? <IdeaModal mode={modal} onClose={() => setModal(null)} onSubmit={addIdea} /> : null}
      <div className={toast ? "toast show" : "toast"} role="status">{toast}</div>
    </div>
  );
}
