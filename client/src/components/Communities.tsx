import { ArrowRight } from "lucide-react";

export interface CommunityTile {
  id: string;
  name: string;
  members: string;
  image: string;
}

export const COMMUNITIES: CommunityTile[] = [
  { id: "c17", name: "C-17", members: "1.2K members", image: "/stages/field.jpg" },
  { id: "c130", name: "C-130", members: "980 members", image: "/stages/discover.jpg" },
  { id: "rotary", name: "Rotary Wing", members: "860 members", image: "/stages/define.jpg" },
  { id: "navair", name: "NAVAIR", members: "1.1K members", image: "/brand/hero-art.jpg" },
  { id: "army", name: "Army Aviation", members: "940 members", image: "/stages/design.jpg" },
  { id: "additive", name: "Additive Manufacturing", members: "2.8K members", image: "/stages/produce.jpg" },
  { id: "cnc", name: "CNC Machining", members: "1.9K members", image: "/stages/validate.jpg" },
  { id: "pcb", name: "Electronics & PCB", members: "1.3K members", image: "/stages/design.jpg" },
  { id: "age", name: "Aerospace Ground Equipment", members: "760 members", image: "/stages/produce.jpg" },
  { id: "joint", name: "Joint / Other", members: "620 members", image: "/brand/hero-art.jpg" },
];

export function Communities({
  query,
  expanded,
  onExpand,
  onOpen,
}: {
  query: string;
  expanded: boolean;
  onExpand: () => void;
  onOpen: (name: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const items = COMMUNITIES.filter((item) => !q || item.name.toLowerCase().includes(q));
  const shown = expanded || q ? items : items.slice(0, 5);
  return (
    <section className="gallery communities" aria-label="Communities">
      <header>
        <h3>Communities</h3>
        <button type="button" className="gallery-all" onClick={onExpand}>
          View all communities <ArrowRight size={14} />
        </button>
      </header>
      {shown.length === 0 ? (
        <p className="empty">No communities match.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="c-card" onClick={() => onOpen(item.name)}>
                <img src={item.image} alt="" />
                <b>{item.name}</b>
                <small>{item.members}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
