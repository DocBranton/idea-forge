import { useEffect, useRef, useState } from "react";
import { Bell, Send, Sparkles, X } from "lucide-react";

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

const OPENING =
  "Wingman online. I can work the selected opportunity — source-of-repair trades, qualification gaps, and aircraft-days recovered.";

function replyTo(text: string, service: ServiceId) {
  const who = service === "army" ? "assistant" : service === "navy" ? "planner" : "Wingman";
  const lower = text.toLowerCase();
  if (lower.includes("hinge") || lower.includes("c-17")) {
    return "C-17 door hinge bracket is in Validate. Forged lead time is 270 days and the aircraft is grounded while waiting. A printed bracket is the trade if the qualification package clears AFLCMC.";
  }
  if (lower.includes("sensor") || lower.includes("group 2")) {
    return "Group 2 UAS sensor mount is in Design. Swapping EO/IR payloads takes 40 minutes and a toolkit on the flight line. Next step is a quick-swap interface that holds the current envelope.";
  }
  if (lower.includes("challenge") || lower.includes("suas") || lower.includes("battery")) {
    return "Open challenges on the board: counter-sUAS detection at austere sites, forward repair of composite skins, and cold-weather battery management. I can open the one that matches the aircraft.";
  }
  return `${who} on station. I can compare a source-of-repair trade, flag a tech-data gap, or point at the stage that owns this idea. Ask about the C-17 hinge, the Group 2 sensor mount, or an open challenge.`;
}

export function WingmanCluster({
  service,
  onService,
  signedIn,
  onOpenNotice,
}: {
  service: ServiceId;
  onService: (id: ServiceId) => void;
  signedIn: { name: string; initials: string } | null;
  onOpenNotice: (id: string) => void;
}) {
  const persona = serviceOf(service);
  const name = signedIn?.name ?? persona.name;
  const initials = signedIn?.initials ?? persona.initials;
  const [open, setOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([
    { id: "gate", object: "C-17 Door Hinge Bracket", exception: "Requirements ready to accept", action: "Accept", tone: "gate" },
    { id: "pool", object: "NDT / CT scanning", exception: "Pool at 184% · slips the hinge", action: "Review", tone: "pool" },
    { id: "micap", object: "C-17 Door Hinge Bracket", exception: "MICAP escalation", action: "Open", tone: "micap" },
  ]);
  const [chat, setChat] = useState<{ role: "bot" | "user"; text: string }[]>([{ role: "bot", text: OPENING }]);
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [chat, open]);

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setChat((rows) => [...rows, { role: "user", text: trimmed }, { role: "bot", text: replyTo(trimmed, service) }]);
    setDraft("");
    setOpen(true);
  }

  return (
    <>
      <button type="button" className="btn-ai" onClick={() => setOpen(true)}>
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
        <button
          type="button"
          className="icon-btn bell"
          title="Decisions"
          aria-expanded={notesOpen}
          onClick={() => setNotesOpen((value) => !value)}
        >
          <Bell size={20} />
          {notices.length > 0 ? <span className="badge-count">{notices.length}</span> : null}
        </button>
        {notesOpen ? (
          <div className="note-panel" role="dialog" aria-label="Decisions">
            <header>
              <h3>DECISIONS</h3>
              <span>{notices.length} open</span>
            </header>
            {notices.length === 0 ? (
              <p className="note-empty">Nothing is waiting on you.</p>
            ) : (
              notices.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`note ${note.tone}`}
                  onClick={() => {
                    setNotices((list) => list.filter((item) => item.id !== note.id));
                    setNotesOpen(false);
                    onOpenNotice(note.id);
                  }}
                >
                  <strong>{note.object}</strong>
                  <b>{note.action}</b>
                  <em>{note.exception}</em>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className={open ? "drawer-backdrop open" : "drawer-backdrop"} onClick={() => setOpen(false)} />
      <aside className={open ? "drawer open" : "drawer"} aria-label={persona.ask}>
        <header className="drawer-h">
          <div>
            <h3>{persona.ask.toUpperCase()}</h3>
            <p>{persona.org}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close wingman" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </header>
        <div className="drawer-thread" ref={thread}>
          {chat.map((msg, i) => (
            <div key={i} className={`msg ${msg.role}`}>
              <span className="msg-kicker">{msg.role === "bot" ? persona.ask : name}</span>
              {msg.text}
            </div>
          ))}
        </div>
        <div className="wing-prompts">
          <button type="button" onClick={() => ask("Walk the C-17 hinge trade")}>C-17 hinge trade</button>
          <button type="button" onClick={() => ask("What is waiting on the Group 2 sensor mount?")}>Group 2 sensor mount</button>
          <button type="button" onClick={() => ask("Which open challenge should we pull forward?")}>Open challenges</button>
        </div>
        <form
          className="drawer-input"
          onSubmit={(event) => {
            event.preventDefault();
            ask(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about a project, a gap, or a trade…"
            aria-label="Ask your Wingman"
          />
          <button type="submit" aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </aside>
    </>
  );
}
