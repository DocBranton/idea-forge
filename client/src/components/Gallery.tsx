import * as React from "react";
import { ArrowRight, Eye, Layers3 } from "lucide-react";

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
  { id: "g1", category: "Training", tone: "training", title: "Medic Training Aid", summary: "Reusable IV practice trainer with replaceable soft-tissue insert", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-medic.svg" },
  { id: "g2", category: "EOD", tone: "eod", title: "Inert EOD Recognition Kit", summary: "Color-coded nonfunctional classroom identification models", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-eod.svg" },
  { id: "g3", category: "Electronics", tone: "electronics", title: "Tactical Radio Retention Clip", summary: "Replaceable low-profile clip for training radio harnesses", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-radio.svg" },
  { id: "g4", category: "Range Safety", tone: "safety", title: "Training Safety Marker", summary: "High-visibility status indicator for inert training fixtures", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-fixture.svg" },
  { id: "g5", category: "Maintenance", tone: "maintenance", title: "Bench Alignment Fixture", summary: "Repeatable setup jig for non-airworthy shop assemblies", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-fixture.svg" },
  { id: "g6", category: "Tool Control", tone: "storage", title: "Modular Tool Control Tray", summary: "Labeled socket organizer with missing-tool visibility", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-tools.svg" },
  { id: "g7", category: "Test & Measurement", tone: "test", title: "Electronics Bench Test Jig", summary: "Stable positioning fixture for classroom test boards", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-test.svg" },
  { id: "g8", category: "Field Support", tone: "field", title: "Expeditionary Cable Clip Set", summary: "Reusable cable routing for temporary field setups", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-field.svg" },
  { id: "g9", category: "Protective", tone: "protective", title: "Connector Dust Cap Kit", summary: "Tethered protective caps for stored training equipment", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-caps.svg" },
  { id: "g10", category: "Maintenance", tone: "maintenance", title: "Non-Marring Panel Tool", summary: "Polymer separation aid for approved shop enclosures", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-fixture.svg" },
  { id: "g11", category: "Electronics", tone: "electronics", title: "Sensor Demo Enclosure", summary: "Serviceable protective housing for classroom electronics", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-test.svg" },
  { id: "g12", category: "Training", tone: "training", title: "Modular Skills Practice Station", summary: "Interchangeable training modules for technical instruction", likes: "DEMO", comments: 0, views: 0, image: "/gallery/showcase-medic.svg" },
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
  const [selected, setSelected] = React.useState<GalleryItem | null>(null);
  const q = query.trim().toLowerCase();
  const items = GALLERY.filter((item) => !q || `${item.title} ${item.category} ${item.summary}`.toLowerCase().includes(q));
  const shown = expanded || q ? items : items.slice(0, 8);
  return (
    <section className="gallery" aria-label="Gallery of projects">
      <header>
        <div><h3>Project Gallery</h3><small>Illustrative engineering demonstration projects</small></div>
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
              <button type="button" className="g-card" onClick={() => { setSelected(item); onOpen(item); }}>
                <img src={item.image} alt="" />
                <span className={`g-cat tone-${item.tone}`}>{item.category}</span>
                <b>{item.title}</b>
                <small>{item.summary}</small>
                <span className="g-stats">
                  <Layers3 size={12} /> Demo project <Eye size={12} /> View details
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <div role="presentation" onClick={() => setSelected(null)} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(7,24,46,.7)",display:"grid",placeItems:"center",padding:16}}><article role="dialog" aria-modal="true" aria-label={selected.title} onClick={e=>e.stopPropagation()} style={{background:"white",color:"#20364d",borderRadius:16,padding:28,maxWidth:700,width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px #0005"}}><button type="button" onClick={()=>setSelected(null)} style={{border:0,background:"#e7f1fa",padding:10,borderRadius:8,cursor:"pointer"}}>← Back to gallery</button><img src={selected.image} alt={selected.title+" concept illustration"} style={{width:"100%",maxHeight:270,objectFit:"cover",borderRadius:12,marginTop:16}}/><p style={{color:"#1972b4",fontWeight:700,fontSize:12,textTransform:"uppercase"}}>{selected.category} · Illustrative case</p><h2>{selected.title}</h2><p>{selected.summary}</p><h3>Mission need</h3><p>Provide a practical, repeatable solution for {selected.category.toLowerCase()} activities while reducing setup effort and improving consistency.</p><h3>Engineering concept</h3><p>Develop a configurable 3D-printed prototype, review material and fit requirements, and capture technician feedback before approving a production approach.</p><h3>Proposed project artifacts</h3><p>Requirements baseline · CAD model · Material selection · Prototype build record · Verification plan · User evaluation</p><p style={{fontSize:12,color:"#64748b"}}>Demonstration content only. No actual fielding, qualification, or approvals are implied.</p></article></div>}
    </section>
  );
}
