import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardList, Plus, Trash2, Users, X } from "lucide-react";
import { COMMUNITIES } from "./Communities";
import { STAGES, type StageId } from "@/lib/data";

export interface TeamMember { id: string; name: string; role: string; organization: string; }
export interface SharedProject {
  id: string; communityId: string; title: string; problem: string; outcome: string;
  stage: StageId; owner: string; team: TeamMember[]; created: string;
}
const initial: SharedProject = {
  id: "shared-c17-fixture", communityId: "c17", title: "C-17 Maintenance Fixture",
  problem: "Maintainers need a safer, repeatable way to position and inspect components during servicing.",
  outcome: "Design and field a low-cost maintenance fixture that reduces inspection time and aircraft downtime.",
  stage: "define", owner: "Gen. John Duselis", created: "Featured project",
  team: [
    { id: "owner", name: "Gen. John Duselis", role: "Project Owner", organization: "AFLCMC / RSO" },
    { id: "engineer", name: "", role: "Engineer", organization: "" },
    { id: "maintainer", name: "", role: "Maintainer", organization: "" },
    { id: "reviewer", name: "", role: "Qualification Reviewer", organization: "" },
  ],
};
const roles = ["Engineer", "Maintainer", "Qualification Reviewer", "AM Specialist", "Supply Chain", "Other"];
const tabs = ["Overview", "Team", "Requirements", "Files", "Discussion", "Milestones"] as const;
type Tab = typeof tabs[number];
const storageKey = "idea-forge-shared-projects-v1";
function readProjects(): SharedProject[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((p) => p && typeof p === "object" && typeof p.id === "string" && Array.isArray(p.team))) return parsed as SharedProject[];
    }
  } catch { /* storage may be blocked */ }
  return [initial];
}
function persist(items: SharedProject[]) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* demo stays usable */ }
}
function communityName(id: string) { return COMMUNITIES.find((c) => c.id === id)?.name ?? "Community"; }
function Avatar({ name }: { name: string }) {
  return <span className="shared-avatar" aria-hidden="true">{name ? name.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase() : "?"}</span>;
}

export function CommunityProjects({ query, signedInName, onStage }: {
  query: string; signedInName: string; onStage: (id: StageId) => void;
}) {
  const [projects, setProjects] = useState<SharedProject[]>(readProjects);
  const [community, setCommunity] = useState("c17");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberOrg, setMemberOrg] = useState("");
  const [memberRole, setMemberRole] = useState("Engineer");
  const [editingTeam, setEditingTeam] = useState(false);
  const q = query.trim().toLowerCase();
  const chosenCommunity = COMMUNITIES.find((c) => c.id === community) ?? COMMUNITIES[0];
  const current = projects.find((p) => p.id === selected);
  const visible = projects.filter((p) => p.communityId === community && (!q || [p.title, p.problem, p.outcome, p.owner].join(" ").toLowerCase().includes(q)));
  function save(next: SharedProject[]) { setProjects(next); persist(next); }
  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim() || !problem.trim()) return;
    const project: SharedProject = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
      communityId: community, title: title.trim(), problem: problem.trim(), outcome: outcome.trim(),
      stage: "define", owner: signedInName, created: "Just now",
      team: [{ id: "owner", name: signedInName, role: "Project Owner", organization: "" }],
    };
    save([project, ...projects]);
    setCreating(false); setSelected(project.id); setTab("Overview");
    setTitle(""); setProblem(""); setOutcome("");
  }
  function addMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!current || !memberName.trim()) return;
    const member: TeamMember = { id: String(Date.now()), name: memberName.trim(), role: memberRole, organization: memberOrg.trim() };
    const index = current.team.findIndex((m) => !m.name && m.role === memberRole);
    const team = [...current.team];
    if (index >= 0) team[index] = member;
    else team.push(member);
    save(projects.map((p) => p.id === current.id ? { ...p, team } : p));
    setMemberName(""); setMemberOrg(""); setEditingTeam(false);
  }
  function removeMember(id: string) {
    if (!current || id === "owner") return;
    save(projects.map((p) => p.id === current.id ? { ...p, team: p.team.filter((m) => m.id !== id) } : p));
  }

  if (current) return (
    <section className="shared-workspace">
      <button type="button" className="shared-back" onClick={() => { setSelected(null); setEditingTeam(false); }}><ArrowLeft size={16}/> {communityName(current.communityId)} community</button>
      <div className="shared-workspace-head panel">
        <div>
          <span className="eyebrow">Community-sponsored team project</span>
          <h2>{current.title}</h2>
          <p>{current.outcome || current.problem}</p>
          <div className="shared-pills"><span className="tag">{communityName(current.communityId)}</span><span className={`tag stage-${current.stage}`}>{STAGES.find((s) => s.id === current.stage)?.title}</span><span className="tag"><Users size={12}/> {current.team.filter((m) => m.name).length} members</span></div>
        </div>
        <button className="shared-primary" onClick={() => onStage(current.stage)}>Open {STAGES.find((s) => s.id === current.stage)?.title} stage <ArrowRight size={16}/></button>
      </div>
      <nav className="shared-tabs" aria-label="Project workspace tabs">{tabs.map((t) => <button type="button" key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</nav>
      {tab === "Team" ? <section className="panel">
        <header><h3>Project team</h3><span>Membership belongs to this project</span></header>
        <div className="shared-team">{current.team.map((m) => <div className="shared-person" key={m.id}><Avatar name={m.name}/><div><b>{m.name || "Open role — community help wanted"}</b><small>{m.role}{m.organization && ` · ${m.organization}`}</small></div>{m.id !== "owner" && <button type="button" aria-label={`Remove ${m.name || m.role}`} onClick={() => removeMember(m.id)}><Trash2 size={15}/></button>}</div>)}</div>
        {!editingTeam ? <button type="button" className="shared-secondary" onClick={() => setEditingTeam(true)}><Plus size={16}/> Add team member</button> : <form className="shared-member-form" onSubmit={addMember}><label>Member name<input required value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Name"/></label><label>Role<select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>{roles.map((r) => <option key={r}>{r}</option>)}</select></label><label>Organization<input value={memberOrg} onChange={(e) => setMemberOrg(e.target.value)} placeholder="Base or organization"/></label><div><button className="shared-primary" type="submit"><Check size={15}/> Add member</button><button className="shared-secondary" type="button" onClick={() => setEditingTeam(false)}>Cancel</button></div></form>}
      </section> : tab === "Overview" ? <div className="shared-overview">
        <section className="panel"><header><h3>Mission challenge</h3></header><p className="shared-prose">{current.problem}</p><h3 className="shared-subhead">Desired outcome</h3><p className="shared-prose">{current.outcome || "Outcome to be developed during Define."}</p></section>
        <section className="panel"><header><h3>Team & collaboration</h3><button type="button" className="gallery-all" onClick={() => setTab("Team")}>View team <ArrowRight size={14}/></button></header><div className="shared-team">{current.team.slice(0, 5).map((m) => <div className="shared-person" key={m.id}><Avatar name={m.name}/><div><b>{m.name || "Open role"}</b><small>{m.role}</small></div></div>)}</div></section>
      </div> : <section className="panel shared-placeholder"><ClipboardList size={24}/><h3>{tab}</h3><p>This project workspace section is ready for integration with shared project data and workflows. No files, messages or milestones have been fabricated.</p>{tab === "Requirements" && <button type="button" className="shared-secondary" onClick={() => onStage("define")}>Continue in Define <ArrowRight size={15}/></button>}</section>}
    </section>
  );

  return <section className="shared-community">
    <header className="shared-title"><div><span className="eyebrow">People · projects · mission outcomes</span><h2>Communities</h2><p>Connect with experts and turn shared ideas into fielded capabilities.</p></div></header>
    <div className="shared-community-layout">
      <div className="shared-community-main">
        <div className="shared-community-picker" aria-label="Select a community">{COMMUNITIES.map((c) => <button type="button" key={c.id} className={community === c.id ? "active" : ""} onClick={() => { setCommunity(c.id); setCreating(false); }}>{c.name}</button>)}</div>
        <div className="shared-community-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(4,13,26,.96),rgba(4,13,26,.36)),url("${chosenCommunity.image}")` }}>
          <span className="eyebrow">Community spotlight</span><h2>{chosenCommunity.name}</h2><p>Share challenges, build teams, and collaborate on practical solutions.</p><div className="shared-hero-stats"><span><Users size={16}/> {chosenCommunity.members}</span><span><ClipboardList size={16}/> {visible.length} shared projects</span></div>
        </div>
        <section className="panel shared-board"><header><h3>Community project board</h3><span>{visible.length} projects</span></header>
          <div className="shared-card-grid">{visible.map((p) => <button type="button" className="shared-project-card" key={p.id} onClick={() => { setSelected(p.id); setTab("Overview"); }}><span className="eyebrow">Team project</span><h4>{p.title}</h4><p>{p.outcome || p.problem}</p><div className="shared-project-footer"><span className={`tag stage-${p.stage}`}>{STAGES.find((s) => s.id === p.stage)?.title}</span><span><Users size={14}/> {p.team.filter((m) => m.name).length}</span><ArrowRight size={16}/></div></button>)}</div>
          {visible.length === 0 && <p className="empty">No projects match in this community. Start the first shared project.</p>}
        </section>
      </div>
      <aside className="panel shared-create">
        {!creating ? <><span className="eyebrow">Build a mission team</span><h3>Have an idea worth sharing?</h3><p>Launch a project sponsored by the {chosenCommunity.name} community. Begin alone, then invite the right expertise as the idea takes shape.</p><button className="shared-primary" type="button" onClick={() => setCreating(true)}>Start a shared project <ArrowRight size={17}/></button><div className="shared-steps"><span>01 Define the challenge</span><span>02 Assemble the team</span><span>03 Collaborate & deliver</span></div></> : <form className="shared-create-form" onSubmit={create}><div className="shared-form-head"><h3>New shared project</h3><button type="button" aria-label="Cancel creation" onClick={() => setCreating(false)}><X size={18}/></button></div><p>Sponsored by {chosenCommunity.name}</p><label>Project title<input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are we building?"/></label><label>Mission problem<textarea required rows={4} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What problem are we solving?"/></label><label>Desired outcome<textarea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What does success look like?"/></label><p className="shared-hint">You are the initial Project Owner. Add engineers, maintainers and reviewers after creation.</p><button className="shared-primary" type="submit"><Plus size={16}/> Create team project</button></form>}
      </aside>
    </div>
  </section>;
}
