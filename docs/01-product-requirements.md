# Idea Forge — Product Requirements Document (PRD)

| | |
| --- | --- |
| Status | Draft v0.1 |
| Date | 9 Oct 2026 |
| Owner | Product (Idea Forge) |
| Related | [Technical requirements](02-technical-requirements.md) · [App flow](03-app-flow.md) · [Design brief](04-design-brief.md) · [Backend schema](05-backend-schema.md) · [Implementation plan](06-implementation-plan.md) |

## 1. Summary

Idea Forge turns bold ideas from Airmen, Soldiers and Sailors into mission-ready capabilities. A person with a real flight-line or depot problem can start a project, pull in the right people, design and validate a part in the browser, find qualified manufacturing capacity, and field the result — all in one place, with a review trail of who decided what.

The product is organized around a six-stage pipeline:

| # | Stage | Caption | What the user does |
| --- | --- | --- | --- |
| 1 | **Define** | Real-world challenges | Frame the problem from the operator's side: who is affected, the mission cost, and what done looks like. |
| 2 | **Discover** | Collaborate on solutions | Find people, prior work and capabilities that already solve part of the problem. |
| 3 | **Design** | Iterate and build | Open CAD in the browser, recognize features, generate a working drawing. |
| 4 | **Validate** | Analyze and optimize | Validate or reject each recognized feature against a requirement, with an auditable trail. |
| 5 | **Produce** | Scale and deliver | Match the design to qualified manufacturing capacity (additive cells to depot shops). |
| 6 | **Field** | Create impact | Put the solution in operators' hands and measure impact against the defined problem. |

Idea Forge runs as a single Databricks App on AppKit and reuses capabilities from the Unified Mission Workbench (UMW): the identity cluster, Verified Engineering CAD, and the CAD review trail.

## 2. Problem

- Good ideas from the field die in email and slide decks. There is no shared place to register a problem, see who else has it, and move it forward.
- Engineering evidence (CAD, feature reviews, requirement traceability) lives in disconnected tools, so qualification reviewers cannot see who validated what.
- Organic manufacturing capacity (additive, CNC, NDT) exists across the enterprise but is hard to discover and match to a design.
- Leaders cannot see the pipeline: how many ideas exist, where they are stuck, and what impact fielded solutions had.

## 3. Goals and non-goals

### Goals

1. **G1 — Intake in under two minutes.** Anyone signed in can start a project with a name and a problem statement.
2. **G2 — One pipeline view.** Every project shows its stage, owner, team and next step; leaders can see counts per stage.
3. **G3 — Verified engineering.** Design and Validate work on real CAD files in the browser, with every review and requirement link attributed to the signed-in user in an append-only trail.
4. **G4 — Community-powered teams.** Communities (airframe, process and service groups) sponsor projects and fill open roles.
5. **G5 — Path to production and fielding.** A project can be matched to manufacturing capability and its fielded impact recorded against the original problem.

### Non-goals (this release line)

- Replacing program-of-record PLM, ERP or airworthiness systems. Idea Forge links to them; it does not become them.
- Handling classified data. The app is for unclassified (CUI at most, subject to the deployment's accreditation) content only.
- Real-time co-editing of CAD geometry. CAD is view, analyze, review and annotate.
- A general-purpose chat product. The Wingman assistant is scoped to projects in the app.

## 4. Users and personas

| Persona | Example (from the concept) | Needs |
| --- | --- | --- |
| **Innovator / Project owner** | MSgt R. Delgado, 436 MXG | Register a problem quickly, recruit help, track progress. |
| **Engineer** | Capt. T. Anderson, AFRL / RW | Open CAD, recognize features, generate drawings, link features to requirements. |
| **Qualification reviewer** | AFLCMC engineering authority | See who validated each feature, against which requirement, and when. Accept requirements. |
| **Maintainer / Operator** | SSgt K. Osei, 820 RHS | Describe the real-world pain, test fit, confirm the fielded fix works. |
| **Manufacturing provider** | OC-ALC additive cell | Advertise capability and capacity, receive matched work. |
| **Sponsor / Leader** | Gen. John Duselis, AFLCMC / RSO | Post challenges, see the pipeline, make decisions on gated items. |
| **Community lead** | C-17 community | Curate the community board, sponsor projects, fill open roles. |

Multi-service: the identity cluster switches between Air Force, Army and Navy framing (Wingman / AI assistant / Plan a mission). Service affects labels and default persona, not permissions.

## 5. Scope and requirements

Priority: **P0** must ship for the stage to be called live; **P1** expected; **P2** later.
Status column reflects the code at `78a46eb`: **Built** (works today), **Mock** (UI exists on mock or browser-only data), **New**.

### 5.1 Shell, identity and navigation

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| SH-1 | Sidebar with Air Force lockup, Idea Forge mark, Workspace (Home, Community, My Work) and Tools (Design Studio, Feature Validation). Collapsible to a rail; choice remembered per browser. | P0 | Built |
| SH-2 | Top bar with back, global search, filter, and the UMW identity cluster (Wingman, service switch, welcome/last logon, decisions bell). | P0 | Built |
| SH-3 | Signed-in user comes from Databricks Apps identity headers (`GET /api/me`); concept persona shown only when no real user is present. | P0 | Built |
| SH-4 | Hero with headline, Start My Own Project, and the six-stage pipeline; collapsible to a band, remembered per browser. | P0 | Built |
| SH-5 | Global search across projects, people, capabilities, challenges and ideas, served from the backend. | P1 | Mock (client-side filter only) |
| SH-6 | Search filters (stage, community, service, unit, owner). | P2 | New |
| SH-7 | Deep links: every project, stage and community view has a URL that survives reload and can be shared. | P1 | New |

### 5.2 Projects and Define

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| PR-1 | Start a project with a name and a problem statement; it begins at Define, owned by the signed-in user. | P0 | Mock (in memory) |
| PR-2 | Projects persist server-side and are visible to all signed-in users. | P0 | New |
| PR-3 | Project page with Overview, Team, Requirements, Files, Discussion, Milestones. | P0 | Mock (Overview and Team only, browser storage) |
| PR-4 | Owner can advance or return a project between stages; every move is recorded with actor, time and reason. | P0 | New |
| PR-5 | Define captures: affected users, mission impact (e.g. aircraft-days, man-hours, lead time), desired outcome, and measurable done criteria. | P0 | Partial (outcome only) |
| PR-6 | Requirements: create, edit and version requirements (ID like `REQ-002`) with statuses Draft → Proposed → Accepted / Rejected. A reviewer accepts. | P0 | New |
| PR-7 | Project cards show stage, a six-dot progress indicator, owner/unit, collaborator count, last update. | P0 | Built (mock data) |

### 5.3 Community and teams (Discover)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| CM-1 | Community picker with spotlight (members, shared project count) and a community project board. | P0 | Mock |
| CM-2 | Start a community-sponsored project; creator is Project Owner. | P0 | Mock (browser storage) |
| CM-3 | Team roster with roles (Project Owner, Engineer, Maintainer, Qualification Reviewer, AM Specialist, Supply Chain, Other) and open roles marked "community help wanted". | P0 | Mock |
| CM-4 | Invite a real directory user to a role; they get a notification and can accept or decline. | P1 | New |
| CM-5 | Join or follow a community. | P1 | New |
| CM-6 | Discover surfaces similar projects, prior gallery items and matching capabilities for a project's problem. | P1 | New |
| CM-7 | Discussion thread per project. | P1 | New |

### 5.4 Design and Validate (Verified Engineering CAD)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| CAD-1 | Open STEP, IGES, BREP, STL, OBJ and glTF in the browser; files stay in the browser unless attached to the project. | P0 | Built |
| CAD-2 | Model tree, display modes, section, measure, units, materials. | P0 | Built |
| CAD-3 | Feature recognition (holes, fillets, bosses, patterns) with review status Inferred / Validated / Rejected. | P0 | Built |
| CAD-4 | Drawing generation with a title block (part number, rev). | P0 | Built |
| CAD-5 | Shared review trail in Lakebase (`foundry.cad_events`), append-only, actor from identity headers. | P0 | Built (server), off until Lakebase is configured |
| CAD-6 | Stage pages use the shared trail scoped to the real project (not the stand-alone browser mode). | P0 | New |
| CAD-7 | Link recognized features to the project's accepted requirements; show a traceability matrix (requirement ↔ features ↔ status ↔ who). | P0 | Partial (engine supports links; no requirement source) |
| CAD-8 | Attach CAD files to a project (stored server-side) with revisions. | P1 | New |
| CAD-9 | Export the review trail and traceability matrix (CSV/PDF) for a qualification package. | P1 | New |

### 5.5 Produce

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| PD-1 | Capability directory: process, materials, site, organization, stage applicability. | P0 | Mock (4 seed capabilities) |
| PD-2 | Request a quote / capacity from a capability for a project; provider can accept, decline or counter with a lead time. | P1 | New |
| PD-3 | Capacity signal (e.g. "NDT / CT pool at 184%") raised as a notification when it slips a project. | P2 | Mock (notice only) |

### 5.6 Field

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| FD-1 | Record fielding: units, quantity, date. | P1 | New |
| FD-2 | Record impact against the Define measures (before vs after). | P1 | New |
| FD-3 | Fielded projects feed the Featured projects gallery. | P2 | Mock (static gallery) |

### 5.7 Challenges

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| CH-1 | Featured challenges with sponsor service, summary, submission count and close date. | P0 | Mock |
| CH-2 | Sponsors post challenges; users submit an existing or new project to a challenge. | P1 | New |
| CH-3 | Sponsor reviews submissions and selects. | P2 | New |

### 5.8 Notifications, decisions and Wingman

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| NT-1 | Decisions bell lists items needing the user (accept requirements, capacity slips, MICAP escalations), each with one action. | P0 | Mock |
| NT-2 | Notifications are generated by real events (stage moves, invites, reviews, requirement status, quotes). | P1 | New |
| WM-1 | Wingman panel with five personas (Operations Officer, Engineer, Mentor, Technical Analyst, Readiness). | P1 | Mock (local scripted answers) |
| WM-2 | Wingman answers grounded in the selected project's data via a model-serving endpoint, with sources shown. | P2 | New |

### 5.9 My Work

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| MW-1 | Projects owned by the signed-in user. | P0 | Mock (match by display name) |
| MW-2 | Plus projects where the user holds a team role, and open decisions assigned to them. | P1 | New |

## 6. User stories (P0)

- As an **innovator**, I start a project with a name and problem so that my idea is registered and visible at Define.
- As a **project owner**, I invite an engineer and a qualification reviewer so the project can move past Define.
- As a **reviewer**, I accept requirements so engineers can link features against them.
- As an **engineer**, I open the part's STEP file, recognize features, and validate each against a requirement so the trail shows who verified what.
- As a **reviewer**, I open the traceability matrix and see every requirement, the linked features, their status and who set it.
- As a **leader**, I see how many projects are at each stage and which decisions are waiting on me.

## 7. Success metrics

| Metric | Target (first 6 months live) |
| --- | --- |
| Projects started | 200 |
| Median time to start a project | < 2 min |
| Projects with ≥ 3 team members by Discover | 60% |
| Projects reaching Validate with a full traceability matrix (every accepted requirement linked) | 40% of those at Validate |
| Review actions attributed to a real signed-in user | 100% (no anonymous writes) |
| Fielded projects with recorded impact | 75% of fielded |
| Weekly active users | 500 |

## 8. Constraints and assumptions

- Runs as one Databricks App (`idea-forge`) on AppKit 0.82, same workspace as UMW. Identity comes only from the Databricks Apps proxy headers.
- Persistent state goes in Lakebase (Postgres) under the `foundry` schema, which is kept so existing review-trail tables do not move.
- CAD processing happens client-side (three.js + OpenCascade WASM, LGPL-2.1, unmodified).
- UMW code is copied, not imported; Idea Forge may diverge but should keep shared components rendering the same (shared design tokens).
- The concept graphic (`docs/concept-hero.png`) is the UI contract.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Lakebase not provisioned, so data stays in browsers | Make Lakebase a P0 dependency for slice 1; keep the browser fallback only for local dev and the CAD stand-alone demo. |
| Users enter sensitive or classified details | Banner and intake guidance; content markings; admin removal tooling; accreditation review before wide release. |
| Mock content mistaken for real | Every mock surface is labeled "concept" until wired; no fabricated files, messages or milestones (already followed in Community workspace). |
| Large CAD files exceed browser memory | Size guidance and a hard limit; meshes-only fallback; server-side conversion later. |
| Identity derived from email handle is wrong | Pull display name and organization from the workspace directory (SCIM) rather than parsing the email. |

## 10. Open questions

1. Who holds the authority to accept requirements and to advance a project past Validate — the project's Qualification Reviewer role, or a named engineering authority group?
2. Which directory is the source of truth for rank, name and unit?
3. Is CUI permitted in this deployment, and what markings are required?
4. Should Army and Navy users see the same communities and challenges, or service-scoped views?
5. Where do fielded-impact numbers come from — self-reported, or joined from maintenance data in the warehouse?
