# Idea Forge — Drawing Extraction Contract

**Version:** 0.2
**Status:** Draft for review
**Scope:** Extracting engineering details from a 2D drawing, engineer review, a locked baseline, and a check of that baseline against a 3D model. Geometry generation, slicing and project sharing are separate contracts (section 11).

The authority model is unchanged from v0.1 and matches the CAD workspace:

> **AI proposes → engineer reviews, corrects or rejects → only a locked baseline is authoritative.**

What changed from v0.1, and why, is in section 12.

---

## 1. Flow

```
Drawing (PDF / image), stored in a Unity Catalog volume
        │
        ▼
Extraction job (async) ──► Extraction: title block, dimensions, GD&T, datums,
        │                   features, notes, BOM — each anchored to the drawing
        ▼
Engineer review ──► append-only review events (who, when, what)
        │
        ▼
Lock ──► Baseline v1, v2, … (immutable, hashed)
        │
        ├──► Model check: baseline vs. features recognized in a 3D model (Validate stage)
        │
        └──► Later contracts: geometry generation, print prep, packaging
```

Nothing in this contract creates geometry. Its first use is the model check: does the 3D model match the drawing?

---

## 2. Rules

1. **AI output is never authoritative.** Every extracted item starts as `Inferred`. Only items an engineer marks `Validated`, or adds, enter a baseline.
2. **The extraction is never edited.** Review is a separate, append-only list of events. The current state of an item is the extraction replayed through its events.
3. **Every action is attributed by the server.** The actor comes from the Databricks Apps headers (`identify()` in `server/cad-events.ts`), never from the browser.
4. **A baseline is a snapshot.** Locking writes an immutable, versioned, hashed baseline. More review after a lock produces the next version on the next lock. It never changes a locked one.
5. **Locking requires a complete review.** No item may still be `Inferred`. Each one is `Validated` or `Rejected`. Rejecting an irrelevant item is one action, so this costs little and guarantees nothing was skipped.
6. **Confidence orders the work. It never decides it.** Model-reported confidence is poorly calibrated. Use it to sort the review list with the least confident first, and never to accept anything automatically.
7. **Every value points to where it came from on the drawing** (section 3.2), so the review screen can highlight it.
8. **Drawings stay inside the workspace.** Extraction runs on a Databricks Model Serving endpoint in the same workspace. No external APIs (section 7).

---

## 3. Types (TypeScript)

These go in `client/src/drawing/types.ts`. The server validates every payload against the same shapes; it does not trust the browser.

### 3.1 Common

```typescript
export type Units = "mm" | "in";

/**
 * Where a value came from. "assumed" replaces v0.1's "inferred", which clashed with
 * the review status of the same name.
 */
export type Provenance =
  | "explicit"  // printed on the drawing
  | "derived"   // computed from printed values (e.g. a total from 4X)
  | "assumed";  // not on the drawing; the model filled it in

/** Same three statuses as CAD feature review (client/src/cad/engine/types.ts). */
export type ReviewStatus = "Inferred" | "Validated" | "Rejected";

/** Who created the item. Engineers can add items the model missed. */
export type Origin = "model" | "engineer";
```

### 3.2 Anchors: where on the drawing

```typescript
export interface Anchor {
  evidenceId: string;
  /** 1-based page (sheet) in the file. */
  page: number;
  /** View label when the drawing names one, e.g. "SECTION A-A", "DETAIL B". */
  view?: string | null;
  /** Box around the text on the page, as fractions of page width/height (0–1), origin top-left. */
  box?: { x: number; y: number; w: number; h: number } | null;
  /** How the box was found. "text-layer" is exact; "model" is the model's estimate. */
  boxSource?: "text-layer" | "model" | "engineer";
}
```

For vector PDFs, the server finds the box by matching the item's exact `text` in the PDF text layer. That gives a precise box without relying on the model. For scans and images, the model's box is used and marked as such.

### 3.3 Source evidence

```typescript
export interface DrawingEvidence {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/tiff";
  /** Unity Catalog volume path. Never inline data. */
  volumePath: string;   // /Volumes/<catalog>/foundry/drawings/<projectId>/<id>.<ext>
  pages: number;
  sha256: string;
  uploadedAt: string;   // ISO-8601
  uploadedBy: string;   // actor id, set by the server
}
```

### 3.4 Extracted values

Every extracted item shares this base:

```typescript
interface ExtractedItem {
  id: string;            // stable within the extraction, e.g. "dim-014"
  text: string;          // exactly as printed, e.g. "4X Ø6.5 ±0.1"
  anchor: Anchor | null; // null only when the item was not printed (provenance "assumed")
  provenance: Provenance;
  confidence: number;    // 0–1, as reported by the model
  origin: Origin;
}
```

**Title block.** For Air Force drawings, the revision, distribution statement and export marking govern what may be built and who may see the file.

```typescript
export interface TextField extends ExtractedItem {
  value: string | null;
}

export interface TitleBlock {
  drawingNumber: TextField | null;
  revision: TextField | null;
  title: TextField | null;
  partNumber: TextField | null;
  cageCode: TextField | null;
  distributionStatement: TextField | null; // e.g. "DISTRIBUTION STATEMENT D: …"
  exportControl: TextField | null;          // ITAR / EAR notices
  material: TextField | null;
  finish: TextField | null;
  scale: TextField | null;
  sheet: TextField | null;                  // "SHEET 1 OF 3"
  units: Units | null;
  dimensioningStandard: TextField | null;   // e.g. "ASME Y14.5-2018"
}
```

**Tolerances**, structured rather than free text:

```typescript
export type Tolerance =
  | { kind: "symmetric"; plusMinus: number }              // ±0.1
  | { kind: "bilateral"; plus: number; minus: number }    // +0.2 / −0.1
  | { kind: "limits"; upper: number; lower: number }      // 6.6 / 6.5
  | { kind: "fit"; designation: string }                  // H7, h6
  | { kind: "basic" }                                     // boxed dimension
  | { kind: "reference" }                                 // (42)
  | { kind: "general"; noteId: string };                  // falls back to a general-tolerance note
```

**Dimensions.** These replace v0.1's lathe-oriented `canonical_dimensions`; `role` is optional and free.

```typescript
export type DimensionType =
  | "linear" | "diameter" | "radius" | "angle" | "chamfer"
  | "thread" | "depth" | "counterbore" | "countersink" | "other";

export interface Dimension extends ExtractedItem {
  type: DimensionType;
  nominal: number | null;
  unit: Units | "deg";
  tolerance: Tolerance | null;
  /** "4X" → 4. */
  count: number | null;
  /** Thread callouts, e.g. "M8x1.25-6H", kept whole. */
  thread?: string | null;
  /** Id of the Feature this dimension sizes or locates, when known. */
  featureId?: string | null;
  /** Optional label for downstream use, e.g. "overall_length". */
  role?: string | null;
}
```

**GD&T and datums:**

```typescript
export type GdtCharacteristic =
  | "straightness" | "flatness" | "circularity" | "cylindricity"
  | "profile_of_a_line" | "profile_of_a_surface"
  | "angularity" | "perpendicularity" | "parallelism"
  | "position" | "concentricity" | "symmetry"
  | "circular_runout" | "total_runout";

export type MaterialCondition = "MMC" | "LMC" | "RFS";

export interface FeatureControlFrame extends ExtractedItem {
  characteristic: GdtCharacteristic;
  tolerance: number;
  diametralZone: boolean;                  // Ø in the frame
  materialCondition: MaterialCondition | null;
  datums: { label: string; materialCondition: MaterialCondition | null }[]; // primary, secondary, tertiary
  featureId?: string | null;
}

export interface Datum extends ExtractedItem {
  label: string;                           // "A"
  featureId?: string | null;
}
```

**Features, notes, BOM:**

```typescript
export type FeatureType =
  | "hole" | "thread" | "slot" | "pocket" | "boss"
  | "fillet" | "chamfer" | "pattern" | "other";

export interface Feature extends ExtractedItem {
  type: FeatureType;
  description: string;                     // "4X Ø6.5 THRU ON Ø50 BC"
  count: number | null;
  dimensionIds: string[];
}

export interface Note extends ExtractedItem {
  kind: "general" | "general_tolerance" | "surface_finish" | "process" | "specification" | "other";
  number?: string | null;                  // "3" for note 3
}

export interface BomRow extends ExtractedItem {
  item: string | null;
  quantity: number | null;
  partNumber: string | null;
  description: string;
  material: string | null;
  specification: string | null;
}
```

### 3.5 Extraction

```typescript
export interface Extraction {
  id: string;
  projectId: string;
  evidenceIds: string[];        // multi-sheet drawings can span files
  modelEndpoint: string;        // serving endpoint name
  promptVersion: string;        // bumps when the prompt changes; ties results to evaluations
  extractedAt: string;

  titleBlock: TitleBlock;
  dimensions: Dimension[];
  gdt: FeatureControlFrame[];
  datums: Datum[];
  features: Feature[];
  notes: Note[];
  bom: BomRow[];

  /** Regions the model could not read (smudged, cropped, too small), for the reviewer. */
  warnings: { anchor: Anchor | null; message: string }[];
}
```

### 3.6 Review events

These follow the same pattern as `foundry.cad_events`: append-only, with the actor set by the server.

```typescript
export type ReviewEvent =
  | { kind: "review"; itemId: string; from: ReviewStatus; to: ReviewStatus }
  /** A correction validates the item with engineer-supplied values. */
  | { kind: "correct"; itemId: string; patch: Partial<Omit<Dimension, "id" | "origin">> }
  | { kind: "add"; item: ExtractedItem & Record<string, unknown>; collection: ItemCollection }
  | { kind: "anchor"; itemId: string; anchor: Anchor }   // engineer moves or draws the box
  | { kind: "comment"; itemId: string; text: string };

export type ItemCollection = "titleBlock" | "dimensions" | "gdt" | "datums" | "features" | "notes" | "bom";

export interface StoredReviewEvent {
  id: number;
  extractionId: string;
  event: ReviewEvent;
  actorId: string;     // from the Databricks Apps headers
  actorEmail: string | null;
  at: string;
}
```

A correction stores only the changed fields. The original value stays in the extraction, so the review screen can show "6.4 → 6.5 (J. Smith, 14 Oct)".

### 3.7 Baseline

```typescript
export interface Baseline {
  id: string;
  projectId: string;
  extractionId: string;
  version: number;              // 1, 2, … per extraction
  /** Validated and engineer-added items only, with corrections applied. */
  titleBlock: TitleBlock;
  dimensions: Dimension[];
  gdt: FeatureControlFrame[];
  datums: Datum[];
  features: Feature[];
  notes: Note[];
  bom: BomRow[];
  /** Last review event included, so the baseline can be reproduced by replay. */
  throughEventId: number;
  /** SHA-256 of the canonical JSON above. Later contracts reference baseline id + hash. */
  contentHash: string;
  lockedAt: string;
  lockedBy: string;
}
```

### 3.8 Model check

The first consumer of a baseline. It runs in the browser as a pure function: the 3D feature recognition is already client-side in the CAD workspace.

```typescript
export type CheckResult = "match" | "out_of_tolerance" | "missing_in_model" | "extra_in_model" | "not_checkable";

export interface ModelCheckRow {
  baselineItemId: string | null;     // null for "extra_in_model"
  featureKey: string | null;         // CAD FeatureKey "<part>#<feature>", null for "missing_in_model"
  result: CheckResult;
  drawing: string | null;            // "Ø6.5 ±0.1"
  model: string | null;              // "Ø6.42"
  delta?: number | null;
}

export interface ModelCheck {
  baselineId: string;
  baselineHash: string;
  modelKey: string;                  // modelKey() from client/src/cad/links.ts
  rows: ModelCheckRow[];
  checkedAt: string;
}

/** client/src/drawing/check.ts */
export declare function checkAgainstModel(b: Baseline, analysis: import("../cad/engine/types").PartAnalysis[]): ModelCheck;
```

v0.2 matching rules, kept deliberately simple:

- **Holes.** Diameter dimensions with a `hole` feature are matched to recognized holes of the same diameter within the dimension's tolerance (or ±0.05 mm when it has none). The feature's count is compared with the number of matched holes.
- **Envelope.** `role: "overall_*"` dimensions are compared with the model's bounding box.
- **Everything else** (GD&T, threads, surface finish) is `not_checkable` in v0.2 and is listed so nobody mistakes silence for a pass.

The check never changes any review status. It produces flags for an engineer to act on.

---

## 4. API

All routes are under the Idea Forge AppKit server. The server sets the actor on every write from the Databricks Apps headers. Errors are `{ "error": string }`.

| Method & path | Body | Result | Errors |
| --- | --- | --- | --- |
| `POST /api/drawings` | multipart: `file`, `projectId` | `DrawingEvidence` | 400, 401, 413 (> 50 MB or > 20 pages), 415 |
| `POST /api/drawings/:id/extractions` | `{ evidenceIds?: string[] }` | **202** `{ jobId }` | 401, 404, 503 (endpoint down) |
| `GET /api/extraction-jobs/:jobId` | — | `{ state: "queued" \| "running" \| "done" \| "failed", extractionId?, error? }` | 404 |
| `GET /api/extractions/:id` | — | `{ extraction, events, current }`. `current` is the replayed state | 401, 404 |
| `POST /api/extractions/:id/events` | `ReviewEvent` | `{ event: StoredReviewEvent, current }` | 400, 401, 404, 422 (fails schema) |
| `POST /api/extractions/:id/lock` | `{ throughEventId }` | `Baseline` | 401, 404, 409 (items still `Inferred`, or newer events than `throughEventId`) |
| `GET /api/baselines/:id` | — | `Baseline` | 401, 404 |

- **Why extraction is a job:** extraction can take tens of seconds on a multi-sheet drawing. The screen polls the job.
- **What locking checks:** `throughEventId` makes the lock refer to what the engineer actually reviewed. A lock is refused if someone else reviewed in the meantime.

---

## 5. Storage

| What | Where |
| --- | --- |
| Drawing files | Unity Catalog volume `/Volumes/<catalog>/foundry/drawings/<projectId>/` |
| Evidence, extractions, baselines | Lakebase, schema `foundry` (alongside `cad_events`): `drawing_evidence`, `extractions` (JSONB), `baselines` (JSONB, unique on `(extraction_id, version)`) |
| Review events | Lakebase `foundry.extraction_events`: append-only, no `UPDATE` or `DELETE` granted to the app role |

As with the CAD review trail, these routes exist only when Lakebase is configured. Without it, the screen says extraction is unavailable rather than falling back to browser storage.

---

## 6. Extraction service

- **Endpoint.** A Databricks Model Serving endpoint named by `DRAWING_MODEL_ENDPOINT`, reached with the app's service principal. The model choice is open (section 13). Whichever is chosen is recorded in every extraction.
- **Prompt.** Versioned in the repository (`server/drawing/prompt-v<N>.md`), with `promptVersion` stored on every extraction.
- **Output.** JSON validated against the schema in section 3. Invalid output fails the job with a clear message; nothing partial is stored.
- **Pages.** Rendered server-side at 200 DPI, each sent as an image. For vector PDFs, the text layer is extracted too and used for anchors (section 3.2).
- **Reuse of `drawing-to-cad-app` `vision.py`.** Its prompt is the starting point, but this is a real change, not a wrapper. It must emit anchors, typed dimensions, structured tolerances, GD&T frames and the title block. The mapping is in section 10.

---

## 7. Data handling

- **Controlled documents.** Drawings are treated as controlled. They stay in the volume and are sent only to the in-workspace serving endpoint. No third-party APIs, and no copies in logs: log ids and hashes, never page images or extracted text.
- **Marking banner.** When the title block yields a distribution statement or export-control notice, the review screen shows it as a banner on every view of that project.
- **Drawing text is data, not instructions.** The prompt says so explicitly, and nothing in the output is executed or rendered as HTML.
- **Access.** Who may upload, review and lock follows the workspace's permissions on the volume and the app. Whether locking needs a separate role is open (section 13).

---

## 8. Acceptance: is extraction good enough?

Before anyone relies on extraction, measure it.

1. **Test set.** 25–30 real drawings with hand-made answer files in this schema. Mix turned parts, plates and brackets, multi-sheet drawings, scans and heavy GD&T.
2. **Evaluation job.** A Databricks job runs the current endpoint and prompt over the set and scores it. It runs on every `promptVersion` or endpoint change, and nightly.
3. **Proposed targets** (to be set by the program, not this contract):

| Measure | Target |
| --- | --- |
| Drawing number and revision, exact match | ≥ 98% |
| Distribution statement and export marking detected when present | 100% |
| Dimensions found (recall), nominal and tolerance exact | ≥ 90% |
| Dimensions reported that are real (precision) | ≥ 95% |
| Anchors overlapping the true location (IoU ≥ 0.5) | ≥ 90% |
| GD&T frames, all fields exact | ≥ 85% |

4. **Calibration.** Report how well confidence predicts correctness. This informs the review screen's sort order only (rule 6).

Below target, the feature can still ship as an aid, labeled as such. Rules 1 and 5 already mean nothing reaches a baseline unreviewed.

---

## 9. Review screen (requirements, not design)

- The drawing on one side, items on the other. Selecting an item highlights its anchor, and selecting a region lists its items.
- Items sorted least-confident first, grouped by collection, with a count of what is left to review.
- One action each for validate, reject and correct, plus add. All are keyboard-reachable.
- Corrections show the original value and the corrected one, with who and when.
- The marking banner (section 7) and the extraction's warnings are always visible.
- Lock is disabled, with the reason shown, until nothing is `Inferred`.
- After a lock, a **Check against model** action runs `checkAgainstModel` against the part open in the CAD workspace and lists the results.

---

## 10. Mapping from `drawing-to-cad-app` `vision.py`

| `vision.py` | v0.2 | Notes |
| --- | --- | --- |
| `part_name`, `part_number`, `material` | `titleBlock.title / partNumber / material` | Now `TextField`s with anchors |
| `units` | `titleBlock.units` | No silent default; null if not printed |
| `canonical_dimensions.*` | `dimensions[]` with optional `role` | Lathe-specific roles become ordinary `role` values |
| `dimensions_seen` | `dimensions[]` | One list, no duplication |
| tolerance / fit strings | `Tolerance` union | Parsed; the original stays in `text` |
| `gdt` strings | `gdt[]` (`FeatureControlFrame`) | Structured |
| `datums` strings | `datums[]` | Anchored |
| `features` | `features[]` | Linked to dimensions by id |
| `surface_finish`, `general_tolerances`, `standards`, `specifications`, `manufacturing_notes`, `notes` | `notes[]` with `kind` | One anchored list |
| `bill_of_materials` | `bom[]` | Anchored |
| provenance `inferred` | `assumed` | Avoids clashing with review status `Inferred` |
| — | `titleBlock.drawingNumber, revision, cageCode, distributionStatement, exportControl, sheet, dimensioningStandard` | New |
| — | `anchor` on every item | New, required for review |

---

## 11. Later contracts

These were in v0.1 and are deliberately out of scope here. Each will reference a baseline by `id` and `contentHash`.

- **Geometry generation.** Turning a locked baseline into a model (parametric code, a lathe preset, or reconstruction). It is the hardest and riskiest step and deserves its own contract, test set and acceptance criteria.
- **Print prep.** Slicing runs in the browser with Kiri:Moto (the Produce stage). There is no server slice endpoint. If print settings are to be saved to a project, the browser posts the settings and estimates after slicing.
- **Packaging and sharing.** 3MF plus sidecar JSON remains a good container. Sharing rules must carry the drawing's distribution statement.

---

## 12. Changes from v0.1

| v0.1 | v0.2 | Why |
| --- | --- | --- |
| Extraction through geometry, slicing and sharing | Extraction, review, baseline and model check | Geometry generation is the risky part and needs its own contract |
| Values had no location | Every item has an `Anchor` | Reviewers must see where a value came from |
| No title block | Drawing number, revision, CAGE, distribution, export control, etc. | They govern what may be built and who may see it |
| Tolerances and GD&T as strings | `Tolerance` union, `FeatureControlFrame` | Engineering decisions need structure |
| Lathe-oriented `canonical_dimensions` | Typed `dimensions[]` with optional `role` | Works for plates, brackets and housings too |
| Five statuses, mutable items, only the lock attributed | CAD's three statuses plus append-only, attributed events | Matches the CAD review trail; full audit |
| One mutable baseline with `locked: true` | Versioned, hashed, immutable baselines | Downstream work can cite exactly what it used |
| Provenance `inferred` | `assumed` | Clashed with status `Inferred` |
| Synchronous extract | Async job | Multi-sheet extraction is slow |
| Base64 `contentRef` | Unity Catalog volume path | Size, and control of where drawings live |
| `POST /slice` on the server | Out of scope; slicing is in the browser | Matches the Produce stage |
| No acceptance criteria | Test set, evaluation job, targets | Measure before trusting |
| — | Model check against the 3D model | First real use of a baseline, reusing Validate's feature recognition |

---

## 13. Open questions

1. **Model.** Which serving endpoint, and is it accredited for these drawings?
2. **Locations.** Catalog for the drawings volume, and the Lakebase instance (shared with the CAD review trail?).
3. **Targets.** Are the section 8 targets right, and who owns the test set?
4. **Locking.** Can any reviewer lock, or only a designated engineer, possibly not the person who reviewed?
5. **Revisions.** When a drawing changes, does a new extraction start fresh, or does review carry over for unchanged items?

---

*End of contract v0.2*
