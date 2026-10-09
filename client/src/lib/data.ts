// Idea Forge mock data. This is the design contract's content, not live data.
// When a slice moves to the warehouse, its query goes in config/queries/ and this
// module keeps only the types.

export type StageId = "define" | "discover" | "design" | "validate" | "produce" | "field";

export interface Stage {
  id: StageId;
  num: number;
  title: string;
  caption: string;
  /** What happens here, shown on the stage page. */
  summary: string;
  /** Which existing capability carries the stage today. */
  capability: string;
  image: string;
}

export const STAGES: Stage[] = [
  {
    id: "define",
    num: 1,
    title: "Define",
    caption: "Real-world challenges",
    summary: "Frame the problem from the operator's side: who is affected, what it costs the mission, and what done looks like.",
    capability: "Idea intake and requirement capture",
    image: "/stages/define.jpg",
  },
  {
    id: "discover",
    num: 2,
    title: "Discover",
    caption: "Collaborate on solutions",
    summary: "Find people, prior work and capabilities across the enterprise that already solve part of the problem.",
    capability: "Search across projects, people and capabilities",
    image: "/stages/discover.jpg",
  },
  {
    id: "design",
    num: 3,
    title: "Design",
    caption: "Iterate and build",
    summary: "Open CAD in the browser, recognize features, and generate a working drawing for review.",
    capability: "Verified Engineering CAD (from UMW)",
    image: "/stages/design.jpg",
  },
  {
    id: "validate",
    num: 4,
    title: "Validate",
    caption: "Analyze and optimize",
    summary: "Validate or reject each recognized feature against its requirement, with a review trail of who decided and when.",
    capability: "CAD feature review trail (from UMW)",
    image: "/stages/validate.jpg",
  },
  {
    id: "produce",
    num: 5,
    title: "Produce",
    caption: "Scale and deliver",
    summary: "Match the design to qualified manufacturing capacity, from additive cells to depot shops.",
    capability: "Manufacturing capability network",
    image: "/stages/produce.jpg",
  },
  {
    id: "field",
    num: 6,
    title: "Field",
    caption: "Create impact",
    summary: "Put the solution in operators' hands and measure the mission impact against the problem you defined.",
    capability: "Fielding and impact tracking",
    image: "/stages/field.jpg",
  },
];

export interface Project {
  id: string;
  title: string;
  problem: string;
  owner: string;
  unit: string;
  stage: StageId;
  updated: string;
  collaborators: number;
}

export const PROJECTS: Project[] = [
  {
    id: "p-stand",
    title: "Adjustable maintenance stand for C-17",
    problem: "The line stand does not reach the hinge line without a second crew and a spotter.",
    owner: "Gen. John Duselis",
    unit: "AFLCMC / RSO",
    stage: "define",
    updated: "2 h ago",
    collaborators: 2,
  },
  {
    id: "p-uas-mount",
    title: "Quick-swap sensor mount for Group 2 UAS",
    problem: "Swapping EO/IR payloads takes 40 minutes and a toolkit on the flight line.",
    owner: "Capt. T. Anderson",
    unit: "AFRL / RW",
    stage: "design",
    updated: "2 h ago",
    collaborators: 6,
  },
  {
    id: "p-c17-hinge",
    title: "C-17 door hinge bracket, printed",
    problem: "Forged bracket has a 270-day lead time and grounds aircraft while waiting.",
    owner: "MSgt R. Delgado",
    unit: "436 MXG",
    stage: "validate",
    updated: "Yesterday",
    collaborators: 9,
  },
  {
    id: "p-tent-heater",
    title: "Expeditionary shelter heater duct",
    problem: "Ducts crack below -20 °F and are not stocked forward.",
    owner: "SSgt K. Osei",
    unit: "820 RHS",
    stage: "discover",
    updated: "3 d ago",
    collaborators: 3,
  },
  {
    id: "p-tool-tray",
    title: "FOD-safe tool tray for F-35 panels",
    problem: "Loose fasteners during panel work are the top FOD source on the line.",
    owner: "TSgt L. Nguyen",
    unit: "388 FW",
    stage: "produce",
    updated: "4 d ago",
    collaborators: 11,
  },
];

export interface Challenge {
  id: string;
  title: string;
  sponsor: string;
  closes: string;
  tags: string[];
}

export const CHALLENGES: Challenge[] = [
  { id: "c-1", title: "Counter-sUAS detection at austere sites", sponsor: "AFWERX", closes: "30 Oct 2026", tags: ["Sensors", "Force protection"] },
  { id: "c-2", title: "Forward repair of composite skins", sponsor: "Rapid Sustainment Office", closes: "14 Nov 2026", tags: ["Sustainment", "Materials"] },
  { id: "c-3", title: "Cold-weather battery management", sponsor: "11th Air Force", closes: "02 Dec 2026", tags: ["Power", "Arctic"] },
];

export interface Capability {
  id: string;
  name: string;
  where: string;
  kind: string;
}

export const CAPABILITIES: Capability[] = [
  { id: "k-1", name: "Metal additive (L-PBF), 15-5 PH and Ti-6Al-4V", where: "Tinker AFB · OC-ALC", kind: "Produce" },
  { id: "k-2", name: "CT scanning and NDT", where: "Hill AFB · OO-ALC", kind: "Validate" },
  { id: "k-3", name: "Reverse engineering and 3D scan", where: "Robins AFB · WR-ALC", kind: "Design" },
  { id: "k-4", name: "Operational test range", where: "Eglin AFB · 96 TW", kind: "Field" },
];
