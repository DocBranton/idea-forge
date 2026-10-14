# Idea Forge — AI-Assisted AM Project Creation Contract

**Version:** 0.1  
**Status:** Draft for implementation  
**Purpose:** Data contract between drawing/photo/sketch vision extraction (from `drawing-to-cad-app` / Databricks multimodal) and Idea Forge AM project creation, review, geometry generation, and slicing.

This contract preserves the Engineering Workbench authority model:

> **AI proposes → Engineer reviews/corrects/validates → Validated baseline drives geometry → Geometry feeds the existing CAD workspace and slicer.**

---

## 1. Overview

An **AM Project** is the unit of work and sharing. It is created either by:

- Uploading an existing package (3MF + settings + metadata), or
- Starting from source evidence (2D drawing, photo, or sketch) and running the AI-assisted flow.

The contract focuses on the second path.

### High-level flow

```
Source Evidence (drawing / photo / sketch)
        │
        ▼
Vision Extraction  ──►  ProposedEvidence (structured JSON)
        │
        ▼
Human Review  ──►  ValidatedBaseline
        │
        ▼
Geometry Generation  ──►  CandidateGeometry (parametric code or mesh/STEP)
        │
        ▼
CadWorkspace (existing)  ──►  review / measure / feature recognition
        │
        ▼
Slicer (Kiri)  ──►  PrintRecipe
        │
        ▼
AM Project Package (shareable)
```

---

## 2. Core Types (TypeScript)

```typescript
/** Provenance of a value. Matches drawing-to-cad vision.py. */
export type Provenance = "explicit" | "derived" | "inferred";

/** Review state of any proposed item. */
export type ReviewStatus = "Proposed" | "Validated" | "Corrected" | "Rejected" | "EngineerAdded";

/** Units used in the baseline. */
export type Units = "mm" | "in";

/** Source of the original evidence. */
export type EvidenceKind = "drawing" | "photo" | "sketch" | "cad_file" | "other";

/** How geometry will be / was generated. */
export type GeometryStrategy =
  | "parametric_code"      // JS / OpenSCAD / brepjs / cascade-core
  | "lathe_preset"         // drawing-to-cad LatheParams style
  | "mesh_reconstruction"  // photo → mesh (fallback)
  | "uploaded";            // user supplied STEP/STL/3MF
```

### 2.1 Source Evidence

```typescript
export interface SourceEvidence {
  id: string;
  kind: EvidenceKind;
  fileName: string;
  mimeType: string;
  /** Base64 data URL or storage reference. */
  contentRef: string;
  uploadedAt: string;          // ISO-8601
  /** Optional page or view index for multi-page PDFs. */
  page?: number;
  notes?: string;
}
```

### 2.2 Vision Extraction Output (`ProposedEvidence`)

This is the direct target shape for the output of `cad/vision.py` (or an equivalent prompt). It is intentionally close to the existing JSON schema so the Python extraction can be reused with minimal change.

```typescript
export interface DimensionValue {
  value: number | null;
  unit?: "mm" | "in" | "deg";
  tolerance?: string | null;   // e.g. "±0.1", "H7"
  fit?: string | null;         // e.g. "H7", "h6"
  evidence?: string | null;    // exact drawing text
  provenance: Provenance;
  confidence: number;          // 0.0–1.0
}

export interface CanonicalDimensions {
  overall_length?: DimensionValue;
  max_outer_diameter?: DimensionValue;
  neck_outer_diameter?: DimensionValue;
  bolt_circle_diameter?: DimensionValue;
  main_bore_diameter?: DimensionValue;
  /** Extensible for other roles. */
  [role: string]: DimensionValue | undefined;
}

export interface BomRow {
  pos?: number | null;
  qty?: number | null;
  unit?: string | null;
  name: string;
  standard?: string | null;
  material?: string | null;
  evidence: string;
}

export interface ExtractedFeature {
  type: string;                // "hole", "fillet", "thread", "chamfer", "pattern", ...
  description: string;
  quantity?: number | null;
  quantity_per_occurrence?: number | null;
  occurrences?: number | null;
  total_quantity?: number | null;
  provenance: Provenance;
  confidence: number;
  /** Optional structured parameters when the model can extract them. */
  parameters?: Record<string, number | string | null>;
}

export interface ProposedEvidence {
  /** Model that produced this extraction. */
  sourceModel: string;
  extractedAt: string;         // ISO-8601

  part_name: string | null;
  part_number: string | null;
  platform: string | null;
  material: string | null;
  units: Units | null;

  canonical_dimensions: CanonicalDimensions;

  /** Flat list of every dimension the model saw. */
  dimensions_seen: DimensionValue[];

  bill_of_materials: BomRow[];
  features: ExtractedFeature[];

  datums: string[];
  gdt: string[];
  surface_finish: string[];
  general_tolerances: string[];
  standards: string[];
  specifications: string[];
  manufacturing_notes: string[];
  notes: string | null;

  /** Raw confidence summary (optional). */
  overallConfidence?: number;
}
```

### 2.3 Validated Baseline

After human review. Only items with status `Validated`, `Corrected`, or `EngineerAdded` are authoritative for geometry generation.

```typescript
export interface ReviewedDimension extends DimensionValue {
  id: string;
  role: string;                // "overall_length", "hole_diameter", "wall_thickness", ...
  status: ReviewStatus;
  /** Engineer override (takes precedence over value when status is Corrected). */
  correctedValue?: number | null;
  correctedTolerance?: string | null;
  reviewerNote?: string;
}

export interface ReviewedFeature extends ExtractedFeature {
  id: string;
  status: ReviewStatus;
  reviewerNote?: string;
}

export interface ValidatedBaseline {
  id: string;
  projectId: string;
  units: Units;
  material: string | null;
  part_name: string | null;
  part_number: string | null;

  dimensions: ReviewedDimension[];
  features: ReviewedFeature[];
  notes: string[];
  standards: string[];

  /** True when the engineer has explicitly accepted the baseline for generation. */
  locked: boolean;
  lockedAt?: string;
  lockedBy?: string;
}
```

### 2.4 Geometry Generation

```typescript
export interface ParametricCode {
  language: "javascript" | "openscad" | "brepjs" | "cascade";
  source: string;
  /** Parameters the UI can expose as sliders. */
  parameters: Array<{
    name: string;
    value: number;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
  }>;
}

export interface CandidateGeometry {
  id: string;
  strategy: GeometryStrategy;
  /** Reference to the baseline that produced this candidate. */
  baselineId: string;

  /** Present when strategy is parametric_code or lathe_preset. */
  parametric?: ParametricCode;

  /** Resulting model that can be loaded into the existing CadWorkspace. */
  model: {
    format: "step" | "stl" | "3mf" | "obj" | "glb";
    /** Storage ref or data URL. */
    contentRef: string;
    /** Optional pre-tessellated ModelData for immediate viewer use. */
    modelDataRef?: string;
  };

  assumptions: string[];
  unresolved: string[];
  generatedAt: string;
  generator: string;           // e.g. "cascade-core", "openscad", "brepjs"
}
```

### 2.5 Print Recipe (Slicer output)

```typescript
export interface PrintRecipe {
  printerProfile: string;
  filament: string;
  process: Record<string, unknown>;   // Kiri / process settings
  /** Estimated print time, material, etc. when available. */
  estimates?: {
    timeSeconds?: number;
    filamentMm?: number;
    filamentGrams?: number;
  };
  gcodeRef?: string;
}
```

### 2.6 AM Project (the shareable unit)

```typescript
export interface AmProject {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  owner: string;

  /** Original inputs. */
  evidence: SourceEvidence[];

  /** Latest vision extraction (may be null if uploaded). */
  proposedEvidence?: ProposedEvidence;

  /** Authoritative after review. */
  baseline?: ValidatedBaseline;

  /** Accepted geometry (may be multiple candidates; one is selected). */
  candidates: CandidateGeometry[];
  selectedCandidateId?: string;

  /** Slicer result. */
  printRecipe?: PrintRecipe;

  /** Sharing. */
  visibility: "private" | "shared" | "public";
  sharedWith?: string[];

  /** Free-form metadata. */
  tags?: string[];
  requirements?: Array<{ id: string; text: string; status: ReviewStatus }>;
}
```

---

## 3. API / Endpoint Sketch

These can be Databricks app routes or Next/Express handlers. All payloads are JSON unless noted.

### 3.1 Create project from evidence

```
POST /api/am-projects
Content-Type: multipart/form-data  (or JSON with contentRef)

Request:
  - file (drawing / photo / sketch)
  - kind: "drawing" | "photo" | "sketch"
  - name?: string

Response: AmProject   (evidence attached, proposedEvidence still empty)
```

### 3.2 Run vision extraction

```
POST /api/am-projects/:id/extract

Request: { evidenceId: string }

Response: {
  project: AmProject,          // proposedEvidence populated
  evidence: ProposedEvidence
}
```

Internally this calls the lifted `analyze_drawing_bytes` logic (or equivalent) and stores the result.

### 3.3 Submit review / lock baseline

```
POST /api/am-projects/:id/baseline

Request: ValidatedBaseline   (or a patch of ReviewedDimension / ReviewedFeature)

Response: AmProject
```

### 3.4 Generate geometry

```
POST /api/am-projects/:id/generate

Request: {
  strategy: GeometryStrategy,
  /** Optional override of generator or prompt. */
  generatorHint?: string
}

Response: {
  project: AmProject,
  candidate: CandidateGeometry
}
```

The generator:

1. Reads the locked `ValidatedBaseline`.
2. Emits parametric code or calls a reconstruction model.
3. Evaluates it in a worker (cascade-core / brepjs / OpenSCAD / etc.).
4. Produces a STEP/STL that the existing `loadCadFile` path can open.
5. Returns a `CandidateGeometry` whose `model.contentRef` can be handed to the CadWorkspace.

### 3.5 Slice

```
POST /api/am-projects/:id/slice

Request: {
  candidateId: string,
  printerProfile: string,
  filament: string,
  processOverrides?: Record<string, unknown>
}

Response: {
  project: AmProject,
  printRecipe: PrintRecipe
}
```

This hands the accepted model to the existing Kiri slicer path.

### 3.6 Share / export package

```
GET  /api/am-projects/:id/package     → 3MF + sidecar JSON (or zip)
POST /api/am-projects/:id/share       → { visibility, sharedWith }
```

---

## 4. Mapping from `drawing-to-cad-app` vision.py

| vision.py field                  | Contract field                          | Notes |
|----------------------------------|-----------------------------------------|-------|
| `part_name`                      | `ProposedEvidence.part_name`            | direct |
| `part_number`                    | `ProposedEvidence.part_number`          | direct |
| `material`                       | `ProposedEvidence.material`             | direct |
| `units`                          | `ProposedEvidence.units`                | default "mm" if null |
| `canonical_dimensions.*`         | `ProposedEvidence.canonical_dimensions` | preserve evidence + confidence |
| `dimensions_seen`                | `ProposedEvidence.dimensions_seen`      | direct |
| `bill_of_materials`              | `ProposedEvidence.bill_of_materials`    | direct |
| `features`                       | `ProposedEvidence.features`             | direct |
| `datums`, `gdt`, `surface_finish`, etc. | same fields                        | direct |
| model name used                  | `ProposedEvidence.sourceModel`          | add on the way out |

Legacy convenience fields (`overall_length`, `max_diameter`, `neck_diameter`) are **not** part of the contract. Consumers must use `canonical_dimensions` so confidence and evidence stay attached.

---

## 5. Geometry Generation Rules

1. **Only a locked baseline may drive generation.**  
   If `baseline.locked !== true`, the generate endpoint returns 409.

2. **Prefer parametric over mesh.**  
   Strategy order for drawings:
   - `lathe_preset` / axisymmetric when the evidence strongly indicates a turned part.
   - `parametric_code` (JS or OpenSCAD) for plates, brackets, simple housings.
   - `mesh_reconstruction` only as an explicit fallback for photos/sketches.

3. **Every generated candidate must list assumptions and unresolved items.**  
   These surface in the CadWorkspace review UI.

4. **Output must be loadable by the existing Idea Forge CAD pipeline.**  
   Preferred formats: STEP (for feature recognition) or STL (for immediate slicing). The `modelDataRef` may contain a pre-built `ModelData` so the viewer can open it without re-parsing.

5. **Parameter exposure.**  
   When parametric code is used, the generator should emit a `parameters` array so the Idea Forge UI can render sliders that re-evaluate the model without a full re-prompt.

---

## 6. Review Authority Rules

- AI output is always `Proposed` until an engineer acts.
- An engineer may:
  - Validate (accept as-is),
  - Correct (supply a new value),
  - Reject (exclude from generation),
  - Add (create an `EngineerAdded` item).
- Geometry generation ignores anything that is not `Validated`, `Corrected`, or `EngineerAdded`.
- The original `ProposedEvidence` is never mutated; the `ValidatedBaseline` is a separate, reviewable artifact.
- Source evidence, extraction, baseline, geometry, and print recipe remain distinguishable in the project.

---

## 7. Example Payloads

### 7.1 ProposedEvidence (excerpt)

```json
{
  "sourceModel": "databricks-llama-4-maverick",
  "extractedAt": "2026-10-13T22:30:00Z",
  "part_name": "Flange Adapter",
  "part_number": "FA-204",
  "material": "Aluminum 6061",
  "units": "mm",
  "canonical_dimensions": {
    "overall_length": {
      "value": 42.0,
      "tolerance": "±0.1",
      "evidence": "42 ±0.1",
      "provenance": "explicit",
      "confidence": 0.95
    },
    "max_outer_diameter": {
      "value": 60.0,
      "evidence": "Ø60",
      "provenance": "explicit",
      "confidence": 0.92
    }
  },
  "features": [
    {
      "type": "hole",
      "description": "4x Ø6.5 on Ø50 PCD",
      "quantity": 4,
      "provenance": "explicit",
      "confidence": 0.88
    }
  ],
  "surface_finish": ["Ra 3.2"],
  "notes": "Break all edges 0.5"
}
```

### 7.2 ValidatedBaseline (excerpt)

```json
{
  "id": "bl_01",
  "projectId": "prj_01",
  "units": "mm",
  "material": "Aluminum 6061",
  "part_name": "Flange Adapter",
  "locked": true,
  "dimensions": [
    {
      "id": "d1",
      "role": "overall_length",
      "value": 42.0,
      "tolerance": "±0.1",
      "evidence": "42 ±0.1",
      "provenance": "explicit",
      "confidence": 0.95,
      "status": "Validated"
    },
    {
      "id": "d2",
      "role": "wall_thickness",
      "value": null,
      "provenance": "inferred",
      "confidence": 0.4,
      "status": "Corrected",
      "correctedValue": 3.0,
      "reviewerNote": "Not on drawing; set for printability"
    }
  ],
  "features": [
    {
      "id": "f1",
      "type": "hole",
      "description": "4x Ø6.5 on Ø50 PCD",
      "quantity": 4,
      "provenance": "explicit",
      "confidence": 0.88,
      "status": "Validated"
    }
  ]
}
```

---

## 8. Implementation Notes

- **Reuse `cad/vision.py` almost verbatim** for the extraction step. Only the response wrapper needs to add `sourceModel` and `extractedAt`.
- **Do not port the Streamlit UI.** Idea Forge already has the shell, CadWorkspace, and Wingman.
- **Geometry kernel choice** is independent of this contract. cascade-core, brepjs, or an OpenSCAD worker can all emit a `CandidateGeometry`.
- **Slicer hand-off** uses the existing Kiri path once a candidate is selected.
- **Sharing** is a packaging concern: the AM Project JSON + geometry files + optional G-code. 3MF is the preferred single-file container when possible.

---

## 9. Next Implementation Steps

1. Add the TypeScript interfaces above to `client/src/am/` (or equivalent) in idea-forge.
2. Create a thin extraction service that wraps the vision.py prompt and Databricks client.
3. Build a minimal review UI that turns `ProposedEvidence` into a `ValidatedBaseline`.
4. Implement one generator (parametric_code via cascade-core or OpenSCAD) that consumes a locked baseline and returns a STEP/STL.
5. Wire the result into the existing `CadWorkspace` and Kiri slicer.
6. Package the project for upload/share.

---

*End of contract v0.1*
