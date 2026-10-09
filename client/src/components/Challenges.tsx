import { ArrowRight, Calendar, FileStack } from "lucide-react";

export interface ChallengeCard {
  id: string;
  service: "USAF" | "USN" | "USA";
  title: string;
  summary: string;
  submissions: number;
  closes: string;
  image: string;
}

export const FEATURED_CHALLENGES: ChallengeCard[] = [
  {
    id: "ch-c17",
    service: "USAF",
    title: "C-17 Maintenance Fixture",
    summary: "Develop a low-cost maintenance fixture for flight line operations.",
    submissions: 12,
    closes: "Closes in 18 days",
    image: "/stages/field.jpg",
  },
  {
    id: "ch-ship",
    service: "USN",
    title: "Shipboard Equipment Bracket",
    summary: "Design a corrosion resistant bracket for shipboard environment.",
    submissions: 8,
    closes: "Closes in 24 days",
    image: "/brand/hero-art.jpg",
  },
  {
    id: "ch-rotor",
    service: "USA",
    title: "Rotary Wing Repair Tooling",
    summary: "Create field-repair tooling for common rotor components.",
    submissions: 15,
    closes: "Closes in 10 days",
    image: "/stages/define.jpg",
  },
];

export function Challenges({
  query,
  expanded,
  onExpand,
  onOpen,
}: {
  query: string;
  expanded: boolean;
  onExpand: () => void;
  onOpen: (title: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const items = FEATURED_CHALLENGES.filter((item) => !q || `${item.title} ${item.service} ${item.summary}`.toLowerCase().includes(q));
  const shown = expanded || q ? items : items.slice(0, 3);
  return (
    <section className="gallery challenges" aria-label="Featured challenges">
      <header>
        <h3>Featured challenges</h3>
        <button type="button" className="gallery-all" onClick={onExpand}>
          View all challenges <ArrowRight size={14} />
        </button>
      </header>
      {shown.length === 0 ? (
        <p className="empty">No challenges match.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="ch-card" onClick={() => onOpen(item.title)}>
                <img src={item.image} alt="" />
                <span className={`svc svc-${item.service}`}>{item.service}</span>
                <b>{item.title}</b>
                <small>{item.summary}</small>
                <span className="ch-meta">
                  <FileStack size={12} /> {item.submissions} submissions
                  <Calendar size={12} /> {item.closes}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
