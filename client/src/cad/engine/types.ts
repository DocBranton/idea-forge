// Shared CAD engine types. Ported from c-engineering-workbench (branch claude/cad-workbench).
import type * as THREE from "three";

export interface BrepFace {
  first: number;
  last: number;
  color?: number[] | null;
}

/** One tessellated body, as produced by the loaders or the procedural sample. */
export interface MeshData {
  name: string;
  color: number[] | null;
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array;
  /** Triangle ranges per B-rep face (STEP/IGES/BREP). Null for mesh-only formats. */
  brepFaces: BrepFace[] | null;
  /** Keep the file color regardless of the material look (e.g. fasteners). */
  keepColor?: boolean;
}

export interface ModelNode {
  name: string;
  meshes: number[];
  children: ModelNode[];
}

export interface ModelData {
  name: string;
  fileName: string;
  /** Millimetres per model unit. STEP output is millimetres; the sample is inches. */
  mmPerUnit: number;
  format: string;
  root: ModelNode;
  meshes: MeshData[];
  sample?: boolean;
  meshOnly?: boolean;
}

interface FaceBase {
  id: number;
  tris: number[];
  area: number;
}
export interface PlaneFace extends FaceBase {
  type: "plane";
  normal: THREE.Vector3;
  offset: number;
}
export interface CylinderFace extends FaceBase {
  type: "cylinder";
  axis: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  cx: number;
  cy: number;
  radius: number;
  /** RMS of the circle fit, in model units. */
  rms: number;
  tMin: number;
  tMax: number;
  /** Angular coverage around the axis, radians. */
  sweep: number;
  angles: number[];
  /** Normals point toward the axis (hole-like). */
  concave: boolean;
}
export interface FreeformFace extends FaceBase {
  type: "freeform";
}
export type Face = PlaneFace | CylinderFace | FreeformFace;

/**
 * Review status of a recognized feature. Recognition only proposes ("Inferred");
 * an engineer validates or rejects.
 */
export type ReviewStatus = "Inferred" | "Validated" | "Rejected";

interface FeatureBase {
  name: string;
  faceIds: number[];
  /** Always "cad_import": features come from geometry, not from people. */
  source: "cad_import";
  /** What the claim rests on, in plain words (faces used and fit quality). */
  evidence: string;
}
export interface HoleFeature extends FeatureBase {
  kind: "hole";
  type: "Hole" | "Counterbore" | "Stepped hole";
  radius: number;
  cbore: { radius: number; depth: number } | null;
  thru: boolean;
  depth: number | null;
  length: number;
  /** Unit vector pointing into the material from the entry. */
  axis: THREE.Vector3;
  entry: THREE.Vector3;
  volumeRemoved: number;
  /** 0–100, derived from the cylinder fit residual. */
  confidence: number;
  segments: number;
  pattern?: string;
  patternCount?: number;
}
export interface FilletFeature extends FeatureBase {
  kind: "fillet";
  type: "Fillet" | "Round";
  radius: number;
  edges: number;
  confidence: number;
}
export interface BossFeature extends FeatureBase {
  kind: "boss";
  type: "Boss";
  radius: number;
  length: number;
  axis: THREE.Vector3;
  entry: THREE.Vector3;
  confidence: number;
}
export interface PatternFeature extends FeatureBase {
  kind: "pattern";
  type: "Pattern";
  members: string[];
  count: number;
  arrangement: "Linear" | "Rectangular" | "Circular" | "Scattered";
}
export type Feature = HoleFeature | FilletFeature | BossFeature | PatternFeature;

export interface PartAnalysis {
  volume: number;
  area: number;
  centroid: THREE.Vector3;
  box: THREE.Box3;
  triangles: number;
  closed: boolean;
  diag: number;
  faces: Face[];
  faceOf: Int32Array;
  faceSource: "brep" | "mesh" | "none";
  features: Feature[];
}

export interface FeatureCounters {
  hole: number;
  fillet: number;
  boss: number;
  pattern: number;
}
