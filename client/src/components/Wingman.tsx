import { useEffect, useRef, useState } from "react";
import { Bell, Sparkles, X } from "lucide-react";
import type { Project } from "@/lib/data";

export type ServiceId = "airforce" | "army" | "navy";

export const SERVICES: { id: ServiceId; label: string; ask: string; name: string; org: string; initials: string }[] = [
  { id: "airforce", label: "Air Force", ask: "Ask your Wingman", name: "Gen. John Duselis", org: "AFLCMC / RSO", initials: "JD" },
  { id: "army", label: "Army", ask: "Ask an AI assistant", name: "COL Dana Reeves", org: "DEVCOM AvMC", initials: "DR" },
  { id: "navy", label: "Navy", ask: "Plan a mission", name: "CAPT Avery Park", org: "NAVAIR", initials: "AP" },
];

export function serviceOf(id: ServiceId) {
  return SERVICES.find((item) => item.id === id) ?? SERVICES[0];
}

interface Notice {
  id: string;
  object: string;
  exception: string;
  action: string;
  tone: "gate" | "pool" | "micap";
}

interface Wingman {
  id: string;
  name: string;
  role: string;
  img: string;
  focus: string;
}

const WINGMEN: Wingman[] = [
  { id: "mira", name: "Capt. Mira", role: "Operations Officer", img: "/wingmen/mira.jpg", focus: "the mission picture and the next decision" },
  { id: "mason", name: "Lt. Mason", role: "Engineer", img: "/wingmen/mason.jpg", focus: "the technical package and what is still unproven" },
  { id: "arden", name: "Chief Arden", role: "Mentor", img: "/wingmen/arden.jpg", focus: "what has to be true before we commit" },
  { id: "nova", name: "Nova", role: "Technical Analyst", img: "/wingmen/nova.jpg", focus: "the evidence and the gaps" },
  { id: "echo", name: "Echo", role: "Readiness", img: "/wingmen/echo.jpg", focus: "aircraft-days, lead time, and capacity" },
];

const WING_KEY = "forge-wingman";

function replyTo(text: string, wing: Wingman, project: Project | undefined) {
  const subject = project ? `${project.title}` : "the selected work";
  const lower = text.toLowerCase();
  if (lower.includes("source") || lower.includes("lead") || lower.includes("cost") || lower.includes("trade")) {
    return `${wing.name.split(" ").slice(-1)[0]}: for ${subject}, organic print is the short trade and the forged source is the long one. Lead time is the constraint, not the drawing. I am watching ${wing.focus}.`;
  }
  if (lower.includes("qual") || lower.includes("airworth") || lower.includes("gap")) {
    return `Qualification still open on ${subject}: material allowables, the flight-line fit check, and the AFLCMC sign-off. ${wing.name.split(" ").slice(-1)[0]} would not commit until those three are on the trail.`;
  }
  if (project) {
    return `${wing.name.split(" ").slice(-1)[0]} on ${subject}. ${project.problem} Owner is ${project.owner}, ${project.unit}, stage ${project.stage}. I am watching ${wing.focus}.`;
  }
  return `${wing.name.split(" ").slice(-1)[0]} on station. Pick a project in flight and I can trade the source of repair, flag the qualification gaps, or open the engineering thread.`;
}

export function WingmanCluster({
  service,
  onService,
  signedIn,
  projects,
  onOpenNotice,
  onOpenStage,
}: {
  service: ServiceId;
  onService: (id: ServiceId) => void;
  signedIn: { name: string; initials: string } | null;
  projects: Project[];
  onOpenNotice: (id: string) => void;
  onOpenStage: (stage: Project["stage"]) => void;
}) {
  const persona = serviceOf(service);
  const name = signedIn?.name ?? persona.name;
  const initials = signedIn?.initials ?? persona.initials;
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([
    { id: "gate", object: "C-17 Door Hinge Bracket", exception: "Requirements ready to accept", action: "Accept", tone: "gate" },
    { id: "pool", object: "NDT / CT scanning", exception: "Pool at 184% · slips the hinge", action: "Review", tone: "pool" },
    { id: "micap", object: "C-17 Door Hinge Bracket", exception: "MICAP escalation", action: "Open", tone: "micap" },
  ]);
  const [wingId, setWingId] = useState(() => {
    try {
      return window.localStorage.getItem(WING_KEY) || "mira";
    } catch {
      return "mira";
    }
  });
  const wing = WINGMEN.find((item) => item.id === wingId) ?? WINGMEN[0];
  const selected = projects.find((item) => item.id === "p-c17-hinge") ?? projects[0];
  const [chat, setChat] = useState<{ role: "bot" | "user"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [chat, open]);

  function chooseWing(id: string) {
    setWingId(id);
    try {
      window.localStorage.setItem(WING_KEY, id);
    } catch {
      /* private window */
    }
  }

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = WINGMEN.find((item) => item.id === wingId) ?? WINGMEN[0];
    setChat((rows) => [...rows, { role: "user", text: trimmed }, { role: "bot", text: replyTo(trimmed, next, selected) }]);
    setDraft("");
    setPicker(false);
    setOpen(true);
  }

  const callsign = wing.name.split(" ").slice(-1)[0];

  return (
    <>
      <button type="button" className="btn-ai" onClick={() => { setPicker(false); setOpen(true); }}>
        <Sparkles size={14} /> <span>{persona.ask}</span>
      </button>
      <div className="svc-switch" role="group" aria-label="Signed-in service">
        {SERVICES.map((item) => (
          <button key={item.id} type="button" className={service === item.id ? "on" : ""} onClick={() => onService(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="logon-note">
        <span className="welcome">Welcome back!</span>
        <span className="last-logon">Last logon: 28 Sep 2026, 07:14 CDT</span>
      </div>
      <div className="user" title={persona.org}>
        <span className="avatar">{initials}</span>
        <span className="user-meta">
          <strong>{name}</strong>
          <span>{persona.org}</span>
        </span>
      </div>
      <div className={notesOpen ? "bell-wrap open" : "bell-wrap"}>
        {notesOpen ? <button className="note-scrim" aria-label="Close decisions" onClick={() => setNotesOpen(false)} /> : null}
        <button type="button" className="icon-btn bell" title="Decisions" aria-expanded={notesOpen} onClick={() => setNotesOpen((value) => !value)}>
          <Bell size={20} />
          {notices.length > 0 ? <span className="badge-count">{notices.length}</span> : null}
        </button>
        {notesOpen ? (
          <div className="note-panel" role="dialog" aria-label="Decisions">
            <header>
              <h3>DECISIONS</h3>
              <span>{notices.length} open</span>
            </header>
            {notices.length === 0 ? <p className="note-empty">Nothing is waiting on you.</p> : notices.map((note) => (
              <button key={note.id} type="button" className={`note ${note.tone}`} onClick={() => { setNotices((list) => list.filter((item) => item.id !== note.id)); setNotesOpen(false); onOpenNotice(note.id); }}>
                <strong>{note.object}</strong>
                <b>{note.action}</b>
                <em>{note.exception}</em>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={open ? "drawer-backdrop open" : "drawer-backdrop"} onClick={() => setOpen(false)} />
      <aside className={open ? "drawer open" : "drawer"} aria-label={persona.ask}>
        <header className="drawer-h">
          <div className="wing-id">
            <img className="wing-face" src={wing.img} alt="" />
            <div>
              <h3>{wing.name}</h3>
              <p><i className="wing-online" /> {wing.role}</p>
            </div>
          </div>
          <div className="wing-tools">
            <button type="button" className="wing-change" onClick={() => setPicker((value) => !value)}>{picker ? "Back" : "Change"}</button>
            <button type="button" className="icon-btn" aria-label="Close wingman" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
        </header>
        {picker ? (
          <div className="persona-grid">
            <p>Different perspectives. Same mission.</p>
            {WINGMEN.map((person) => (
              <button key={person.id} type="button" className={person.id === wing.id ? "persona on" : "persona"} onClick={() => { chooseWing(person.id); setPicker(false); }}>
                <img src={person.img} alt="" />
                <span className="persona-copy">
                  <strong>{person.name}</strong>
                  <em>{person.role}</em>
                  <span>{person.focus}</span>
                </span>
                <b>{person.id === wing.id ? "On duty" : "Select"}</b>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="drawer-thread" ref={thread}>
              <div className="insight">
                <strong>{callsign}'s insight</strong>
                <p>
                  {selected ? `${selected.title}. ${selected.problem} ${selected.owner} owns it at ${selected.unit}. ` : "No project is selected. "}
                  {callsign} is watching {wing.focus}.
                </p>
              </div>
              <ol className="wing-next">
                <li><button type="button" onClick={() => { setOpen(false); onOpenStage("design"); }}>Open the engineering thread</button></li>
                <li><button type="button" onClick={() => ask("Trade the sources of repair")}>Compare cost and lead time</button></li>
                <li><button type="button" onClick={() => ask("What qualification is still open?")}>Review airworthiness gaps</button></li>
              </ol>
              {chat.map((msg, i) => (
                <div key={i} className={`msg ${msg.role}`}>
                  <span className="msg-kicker">{msg.role === "bot" ? callsign : "You"}</span>
                  {msg.text}
                </div>
              ))}
            </div>
            <form className="drawer-input" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Ask ${callsign} about the ${selected?.title.toLowerCase() ?? "work"}…`} aria-label="Ask your Wingman" />
              <button type="submit" aria-label="Send"><Sparkles size={16} /></button>
            </form>
          </>
        )}
      </aside>
    </>
  );
}
