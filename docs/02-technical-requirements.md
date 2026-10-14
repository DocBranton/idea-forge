# Idea Forge — Technical Requirements Document (TRD)

| | |
| --- | --- |
| Status | Draft v0.1 |
| Date | 9 Oct 2026 |
| Baseline | `main` at `78a46eb` |
| Related | [PRD](01-product-requirements.md) · [Backend schema](05-backend-schema.md) · [Implementation plan](06-implementation-plan.md) |

## 1. Purpose

This document states how Idea Forge is built and what the system must do technically to meet the [PRD](01-product-requirements.md). It records the current architecture as found in the repository and the target architecture for the slices that move mock data to Lakebase.

## 2. Current state (as built)

| Area | Today |
| --- | --- |
| Runtime | Databricks App `idea-forge`, AppKit `0.82.0` (`createApp` with `server()` and, when configured, `lakebase()` plugins). Started with `npm run start` (`app.yaml`). |
| Server | `server/server.ts` (30 lines). Routes: `GET /api/me`, `GET /api/cad/status`, `GET/POST /api/cad/events` (the last two only when `LAKEBASE_ENDPOINT` is set). |
| Persistence | Only `foundry.cad_events` in Lakebase (append-only, triggers block UPDATE/DELETE/TRUNCATE). Everything else is mock (`client/src/lib/data.ts`, component-level constants) or `localStorage`. |
| Client | React 19 SPA built by Vite 7, Tailwind 4 plugin present, styles in `foundry.css` (design tokens) and `community-projects.css`. No router — view state is a React union in `App.tsx`. |
| CAD | `client/src/cad/` — three.js 0.170 viewer, OpenCascade import via WASM worker (`client/public/cad/occt-worker.js`), feature analysis, drawing generation. Lazy-loaded on Design/Validate. |
| Identity | `identify()` reads `x-forwarded-user`, `x-forwarded-email`, `x-forwarded-preferred-username`. In `NODE_ENV=development` a `local-dev` actor is used; in production requests without identity are refused for writes. |
| Tests | `node:test` via `tsx`: `test:cad` (engine, links, store) and `test:server` (review trail against real Postgres when `CAD_TEST_DATABASE_URL` is set). |
| CI/CD | `ci.yml`: typecheck, build, CAD tests, server tests against a `postgres:16` service. `deploy-databricks.yml`: build and deploy via Databricks CLI on `workflow_dispatch` and push to `main` (fails fast without `DATABRICKS_TOKEN`). |

> Note: the README says the deploy workflow is manual until the secret exists, but the workflow already has a `push` trigger on `main`. Reconcile in Phase 0 of the [implementation plan](06-implementation-plan.md).

## 3. Target architecture

```
Browser (React SPA)
  ├─ Shell / Home / Community / My Work / Stage views
  ├─ CAD workspace (lazy chunk: three.js + OCCT WASM worker)
  └─ API client  ──fetch /api/*──▶
                                   Databricks Apps proxy  (SSO; injects x-forwarded-* identity)
                                      │
                                   AppKit server (Node 22, Express via appkit.server.extend)
                                      ├─ identity middleware  → req.actor
                                      ├─ route modules: me, projects, communities, requirements,
                                      │                 cad, files, challenges, capabilities,
                                      │                 notifications, search, wingman
                                      ├─ stores (one class per aggregate, pg queries)
                                      └─ migrations runner (on start)
                                      │
                       ┌──────────────┼───────────────────────────┐
                 Lakebase (Postgres)   Unity Catalog Volume         Model Serving (P2)
                 schema `foundry`      /Volumes/.../idea_forge/     Wingman grounded answers
                 (system of record)    files (CAD, attachments)
                       │
                 (optional) synced to Delta in Unity Catalog for analytics / leader dashboards
```

### 3.1 Principles

1. **One app, one schema.** All transactional data in Lakebase schema `foundry`. Do not rename it.
2. **Identity from the proxy only.** The actor on every write comes from `identify(req)`; any `by`, `owner`, `actor` in a request body is ignored.
3. **Audit by append.** State changes that matter to qualification or accountability (CAD reviews, requirement status, stage moves, role changes) are appended to event tables; current state is either derived or kept in a row updated in the same transaction as its event.
4. **Fail loudly, never silently fall back.** If Lakebase is configured but unreachable, writes return 5xx with a plain message ("Nothing was changed"). The browser-storage fallback exists only when Lakebase is not configured (local dev, demo).
5. **Copy, don't import, from UMW.** Shared components keep UMW design tokens so they render identically.
6. **No fabricated data in live surfaces.** Mock modules remain only behind a `concept` label until the slice is wired.

## 4. Functional technical requirements

### 4.1 Identity and authorization

| ID | Requirement |
| --- | --- |
| T-ID-1 | An Express middleware runs `identify(req)` on every `/api/*` request and attaches `req.actor` (or null). |
| T-ID-2 | On first sight of an actor, upsert `foundry.people` (id, email, last_seen_at). Display name and org come from the directory (SCIM via the app's service principal) when available; fall back to parsing the email handle. |
| T-ID-3 | All mutating routes return `401` with a plain sentence when `req.actor` is null. |
| T-ID-4 | Authorization is role-based per project: `owner`, `engineer`, `maintainer`, `qualification_reviewer`, `am_specialist`, `supply_chain`, `other`, plus app-level `admin` (configured list of user ids/groups). Rules in [App flow §6](03-app-flow.md#6-permissions-matrix). |
| T-ID-5 | The `local-dev` identity is never accepted when `NODE_ENV=production`. |

### 4.2 API

REST over JSON, all under `/api`. Every response sets `Cache-Control: no-store`. Errors are `{ "error": "<plain sentence>" }` with `400` (validation), `401`, `403`, `404`, `409` (conflict / stale version), `500`.

| Method & path | Purpose |
| --- | --- |
| `GET /api/me` | Signed-in user (exists). Extend with `name`, `org`, `roles`. |
| `GET /api/projects?stage=&community=&owner=me&q=&cursor=` | List projects (paged, 50). |
| `POST /api/projects` | Create `{title, problem, communityId?}` → starts at `define`, actor is owner. |
| `GET /api/projects/:id` | Project with team, counts, current stage. |
| `PATCH /api/projects/:id` | Edit Define fields; requires `version` for optimistic concurrency. |
| `POST /api/projects/:id/stage` | `{to, reason}` — move stage; appends `project_stage_events`. |
| `GET/POST /api/projects/:id/members` · `DELETE /api/projects/:id/members/:memberId` | Team roster, invites, open roles. |
| `POST /api/invites/:id/accept` · `/decline` | Respond to an invite. |
| `GET/POST /api/projects/:id/requirements` · `PATCH /api/requirements/:id` · `POST /api/requirements/:id/status` | Requirements and their status changes. |
| `GET /api/projects/:id/traceability` | Requirements × linked CAD features × review status × actor. |
| `GET/POST /api/projects/:id/files` · `GET /api/files/:id/content` | Upload/download attachments (CAD and documents) via UC Volume. |
| `GET/POST /api/projects/:id/messages` | Discussion. |
| `GET/POST /api/projects/:id/milestones` · `PATCH /api/milestones/:id` | Milestones. |
| `GET /api/cad/status` · `GET/POST /api/cad/events` | Existing review trail; `project` must be a real project id once projects are server-side. |
| `GET /api/communities` · `GET /api/communities/:id` · `POST /api/communities/:id/membership` | Communities and membership. |
| `GET /api/challenges` · `POST /api/challenges` · `POST /api/challenges/:id/submissions` | Challenges. |
| `GET /api/capabilities` · `POST /api/projects/:id/quotes` · `PATCH /api/quotes/:id` | Produce. |
| `POST /api/projects/:id/fieldings` · `POST /api/projects/:id/impact` | Field. |
| `GET /api/notifications` · `POST /api/notifications/:id/read` | Decisions bell. |
| `GET /api/search?q=&types=` | Unified search. |
| `POST /api/wingman` | (P2) Grounded assistant; streams. |

Input validation follows the existing `cad-events.ts` pattern: small typed parse functions that throw a `…InputError` mapped to `400`, with explicit length limits.

### 4.3 Persistence

| ID | Requirement |
| --- | --- |
| T-DB-1 | Schema and DDL as in [Backend schema](05-backend-schema.md). |
| T-DB-2 | Migrations are numbered SQL files in `server/migrations/NNN_name.sql`, applied in order at start inside a transaction, tracked in `foundry.schema_migrations`, guarded by `pg_advisory_lock` so concurrent instances do not race. The existing `CadEventStore.ensureSchema()` becomes migration `001`. |
| T-DB-3 | Tables are owned by the app's service principal (deploy before developing locally, per AppKit Lakebase docs). |
| T-DB-4 | Mutable rows carry `version INT` for optimistic concurrency; a stale `version` returns `409`. |
| T-DB-5 | Event tables are append-only via the same trigger pattern as `cad_events`. |
| T-DB-6 | Writes that change state and record an event happen in one transaction. Per-aggregate serialization uses `pg_advisory_xact_lock` keyed like `CadEventStore.record`. |

### 4.4 Files

| ID | Requirement |
| --- | --- |
| T-FL-1 | Binary content in a Unity Catalog Volume (declared as an app resource), metadata in `foundry.files`. |
| T-FL-2 | Max upload 200 MB per file (configurable); allow-list of extensions: `.step .stp .iges .igs .brep .stl .obj .gltf .glb .pdf .png .jpg .docx .xlsx .csv`. |
| T-FL-3 | Store SHA-256 of content; the CAD model key used by the review trail is derived from file id + revision so reviews follow the attached file. |
| T-FL-4 | Downloads stream through the server after an authorization check; no public URLs. |

### 4.5 Client

| ID | Requirement |
| --- | --- |
| T-CL-1 | Introduce URL routing (hash or History API) with routes listed in [App flow §3](03-app-flow.md#3-routes). Back button maps to browser history. |
| T-CL-2 | A small typed API client (`client/src/lib/api.ts`) wraps `fetch`, maps errors to toasts, and never sends identity fields. |
| T-CL-3 | Data loading with suspense-friendly hooks and cache invalidation on mutation (a hand-rolled hook or TanStack Query — decide in Phase 1; keep bundle impact < 15 KB gz). |
| T-CL-4 | `client/src/lib/data.ts` keeps the types; mock arrays move to `client/src/lib/concept.ts` and are used only by surfaces still labeled concept. |
| T-CL-5 | CAD workspace in stage views receives `project`, `requirements`, `session`, `onAction` (controlled mode) backed by `RemoteSessionStore`; stand-alone mode remains for no-Lakebase. |
| T-CL-6 | `localStorage` use stays limited to per-viewer conveniences (hero collapsed, rail, service, chosen Wingman), wrapped in try/catch (existing pattern). |

## 5. Non-functional requirements

| Category | Requirement |
| --- | --- |
| Performance | Initial shell JS ≤ 250 KB gz (CAD chunk excluded and lazy). Home interactive < 2.5 s on a typical government laptop over VPN. API p95 < 300 ms for reads, < 500 ms for writes at 50 concurrent users. CAD: a 50 MB STEP opens < 20 s client-side. |
| Availability | Inherits Databricks Apps; target 99.5% business hours. App restarts must be safe (idempotent migrations). |
| Scalability | 10k projects, 100k events per year without schema change; list endpoints are paged and indexed. |
| Security | SSO through Databricks Apps only; no app-level passwords. All SQL parameterized. CSP restricting scripts to self (fonts from Google Fonts until self-hosted). Input length limits on every field. Uploads type- and size-checked. Secrets only in Databricks secret scopes / app resources. |
| Audit | Every write records actor id, email and timestamp. Review, requirement, stage and membership history cannot be edited or deleted through the app or SQL (triggers). |
| Privacy & data handling | Unclassified only; CUI pending accreditation decision. Admin "remove content" hides rows (soft delete flag on mutable tables) and logs who did it; event tables are never deleted. |
| Accessibility | WCAG 2.1 AA: keyboard reachable, visible focus (already `:focus-visible` cyan outline), labels on icon buttons, `prefers-reduced-motion` honored (exists), contrast ≥ 4.5:1 for text. |
| Browser support | Current Chrome and Edge (government standard); Firefox and Safari best-effort. WebGL2 and WebAssembly required for CAD. |
| Observability | Structured JSON logs (`[area] message` with request id and actor id), one line per request and per failed query. Health route `GET /api/health` checks Lakebase reachability. |
| Licensing | OpenCascade (LGPL-2.1) shipped unmodified with license files (exists). Track third-party licenses in `THIRD_PARTY.md`. |

## 6. Environments and configuration

| Variable / resource | Where | Purpose |
| --- | --- | --- |
| `LAKEBASE_ENDPOINT` | `app.yaml` from the `postgres` app resource | Enables Lakebase plugin, stores and routes. |
| `postgres` resource | `databricks.yml` (`postgres_branch`, `postgres_database` variables) | Lakebase branch and database. Currently commented out — uncomment in Phase 1. |
| UC Volume resource | `databricks.yml` | File storage (Phase 3). |
| `IDEA_FORGE_ADMINS` | `app.yaml` env | Comma-separated user ids or emails with admin rights. |
| `CAD_DEV_USER` | `.env` (local only) | Display name for the local-dev actor. |
| `CAD_TEST_DATABASE_URL` | CI | Postgres for server integration tests. |
| `DATABRICKS_TOKEN` | GitHub secret | Deployment. |

Environments: **local** (no Lakebase, browser fallback; or a local Postgres via `LAKEBASE_ENDPOINT`-equivalent pool config), **dev** (Lakebase branch `dev`), **prod** (Lakebase branch `main`). Use Lakebase branching for preview databases per pull request when available.

## 7. Testing

| Layer | Tooling | Required coverage |
| --- | --- | --- |
| Pure logic (CAD engine, links, parsers, permission rules) | `node:test` + `tsx` | All parse/validate functions and permission matrix. |
| Stores against Postgres | `node:test`, CI `postgres:16` service | Every store method, append-only triggers, concurrency (advisory locks), migrations idempotent. |
| Routes | Structural `RouteHost` fakes (existing pattern in `cad-events.test.ts`) | 400/401/403/409 paths. |
| UI | Add Playwright smoke tests in Phase 2: start project, move stage, review a feature. | Golden paths in [App flow](03-app-flow.md). |
| Accessibility | `@axe-core/playwright` on Home, Project, Stage views. | No serious/critical violations. |

## 8. Dependencies and versions

Pinned in `package.json`: AppKit 0.82.0, React 19.2.4, three 0.170.0, Vite 7.2.4, TypeScript 5.9.3, Tailwind 4.1.17, tsdown 0.20.3, Node 22 in CI. Adding `pg` as an explicit dependency is required (server tests import it; today it arrives transitively).

## 9. Technical risks

| Risk | Mitigation |
| --- | --- |
| AppKit Lakebase plugin API changes on upgrade | Pin the version; keep the `Db` structural interface so stores don't depend on AppKit types. |
| No router today; adding one touches every navigation call | Do it once in Phase 1 behind the existing `navigate(view)` function so call sites don't change. |
| CAD model keys today are file-derived hashes, not project-scoped | Scope trail by real project id plus file id/revision once files are server-side; migration maps old keys only if needed (stand-alone browser data is not migrated). |
| Directory lookup permissions for the service principal | Fall back to email parsing; surface "name from directory unavailable" in logs only. |
