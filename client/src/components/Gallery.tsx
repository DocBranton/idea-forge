import { ArrowRight, Eye, Heart, MessageCircle } from "lucide-react";

export interface GalleryItem {
  id: string;
  category: string;
  tone: string;
  title: string;
  summary: string;
  likes: string;
  comments: number;
  views: number;
  image: string;
}

export const GALLERY: GalleryItem[] = [
  { id: "g1", category: "Training", tone: "training", title: "Medic Training Aid", summary: "Realistic IV arm for field training", likes: "1.2K", comments: 48, views: 12, image: "/gallery/training.svg" },
  { id: "g2", category: "EOD", tone: "eod", title: "Explosive Ordnance Tool", summary: "Modular disposal tool set", likes: "980", comments: 32, views: 8, image: "/gallery/eod.svg" },
  { id: "g3", category: "Electronics", tone: "electronics", title: "Radio Belt Clip", summary: "Low-profile, high-strength clip", likes: "860", comments: 21, views: 6, image: "/gallery/electronics.svg" },
  { id: "g4", category: "Range Safety", tone: "safety", title: "Gun Barrel Safety Block", summary: "Bright, durable chamber block", likes: "1.4K", comments: 21, views: 9, image: "/gallery/safety.svg" },
  { id: "g5", category: "Maintenance", tone: "maintenance", title: "Maintenance Aid Fixture", summary: "Engine access alignment tool", likes: "920", comments: 28, views: 10, image: "/gallery/maintenance.svg" },
  { id: "g6", category: "Storage", tone: "storage", title: "Tool Organizer", summary: "Modular socket and tool rack", likes: "1.1K", comments: 26, views: 4, image: "/gallery/storage.svg" },
  { id: "g7", category: "Test & Measurement", tone: "test", title: "Test Fixture", summary: "Electronics test jig", likes: "780", comments: 19, views: 7, image: "/gallery/test.svg" },
  { id: "g8", category: "Field Support", tone: "field", title: "Cable Management", summary: "Rugged cable clip set", likes: "1.3K", comments: 31, views: 5, image: "/gallery/field.svg" },
  { id: "g9", category: "Protective", tone: "protective", title: "Connector Cap Set", summary: "Environmental protection", likes: "640", comments: 18, views: 3, image: "/gallery/protective.svg" },
  { id: "g10", category: "Maintenance", tone: "maintenance", title: "Panel Removal Tool", summary: "Non-marring composite tool", likes: "970", comments: 24, views: 4, image: "/gallery/maintenance.svg" },
  { id: "g11", category: "Electronics", tone: "electronics", title: "Rugged Electronics Housing", summary: "Field-ready enclosure", likes: "1.1K", comments: 29, views: 6, image: "/gallery/electronics.svg" },
  { id: "g12", category: "Training", tone: "training", title: "Tactical Skills Trainer", summary: "Modular training device", likes: "820", comments: 27, views: 5, image: "/gallery/training.svg" },
  { id: "g13", category: "Inspection", tone: "inspection", title: "Visual Inspection Aid", summary: "Alignment and inspection tool", likes: "690", comments: 20, views: 3, image: "/gallery/inspection.svg" },
  { id: "g14", category: "Manufacturing", tone: "manufacturing", title: "Assembly Jig", summary: "Repeatable build fixture", likes: "1.0K", comments: 25, views: 4, image: "/gallery/manufacturing.svg" },
  { id: "g15", category: "Field Support", tone: "field", title: "Storage Case Insert", summary: "Custom foam organization", likes: "860", comments: 23, views: 5, image: "/gallery/field.svg" },
  { id: "g16", category: "Maintenance", tone: "maintenance", title: "Fluid Handling Tool", summary: "Safe fluid transfer adapter", likes: "780", comments: 17, views: 4, image: "/gallery/maintenance.svg" },
];

export function Gallery({
  query,
  expanded,
  onExpand,
  onOpen,
}: {
  query: string;
  expanded: boolean;
  onExpand: () => void;
  onOpen: (item: GalleryItem) => void;
}) {
  const q = query.trim().toLowerCase();
  const items = GALLERY.filter((item) => !q || `${item.title} ${item.category} ${item.summary}`.toLowerCase().includes(q));
  const shown = expanded || q ? items : items.slice(0, 8);
  return (
    <section className="gallery" aria-label="Gallery of projects">
      <header>
        <h3>Featured projects</h3>
        <button type="button" className="gallery-all" onClick={onExpand}>
          View all projects <ArrowRight size={14} />
        </button>
      </header>
      {shown.length === 0 ? (
        <p className="empty">No projects match.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="g-card" onClick={() => onOpen(item)}>
                <img src={item.image} alt="" />
                <span className={`g-cat tone-${item.tone}`}>{item.category}</span>
                <b>{item.title}</b>
                <small>{item.summary}</small>
                <span className="g-stats">
                  <Heart size={12} /> {item.likes}
                  <MessageCircle size={12} /> {item.comments}
                  <Eye size={12} /> {item.views}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
