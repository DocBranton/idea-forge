# Idea Forge — Design Brief

| | |
| --- | --- |
| Status | Draft v0.1 |
| Date | 9 Oct 2026 |
| UI contract | [`docs/concept-hero.png`](concept-hero.png) |
| Related | [PRD](01-product-requirements.md) · [App flow](03-app-flow.md) |

## 1. The brief in one paragraph

Idea Forge should feel like a mission operations console that invites people in — the confidence of a command center, the warmth of a maker community. The user is an Airman with a real problem and twenty minutes between tasks. Within seconds they should understand three things: *I can start something here*, *I can see where everything is*, and *the work here is verified and attributed*. The concept graphic is the contract: dark navy field, cyan signal light, the six-stage pipeline as the spine of the product.

## 2. Audience and context

- **Who:** enlisted maintainers, junior officers and engineers, qualification authorities, senior sponsors; Air Force first, Army and Navy supported.
- **Where:** government laptops (often 1366–1920 px wide) behind VPN, sometimes large ops-floor displays (≥ 2560 px), occasionally phones on the flight line.
- **Mood they arrive in:** busy, skeptical of "another portal", proud of their idea. Respect their time; make progress visible.

## 3. Design principles

1. **The pipeline is the spine.** Define → Discover → Design → Validate → Produce → Field appears in the hero, on every project card (six-dot progress) and on every stage page. Users should always know where a project is and what's next.
2. **Mission-grade, not militaristic.** Precise type, quiet surfaces, signal colors used sparingly. No camouflage, no stencil fonts, no gratuitous HUD chrome.
3. **Verified means visible.** Every decision shows who and when. Status chips (Inferred / Validated / Rejected; Draft / Proposed / Accepted) are first-class, never hidden in tooltips.
4. **Honest concept.** Anything not yet live is labeled as concept. No fabricated files, messages, metrics or milestones.
5. **Plain language.** Short, direct sentences. Errors say what happened and that nothing changed. No jargon the operator wouldn't use.
6. **One primary action per view.** Start My Own Project, Start a shared project, Validate, Request quote — one emphasized button, the rest secondary.

## 4. Visual language

### 4.1 Color (from `client/src/foundry.css`, shared with UMW)

| Token | Value | Use |
| --- | --- | --- |
| `--bg-0` | `#050910` | App background |
| `--bg-1` … `--bg-4` | `#07101c` → `#10243c` | Layered surfaces, inputs, hover |
| `--sidebar` | `#050d18` | Sidebar base (gradient from `#071222`) |
| `--card` | `rgba(9,22,40,.78)` | Panels over art (with blur) |
| `--line` / `--line-strong` | cyan at 22% / 42% | Hairlines, focus-adjacent borders |
| `--cyan` / `--cyan-2` | `#3ee0ff` / `#19c6e8` | Primary signal: active nav, focus ring, links, pipeline current |
| `--blue` / `--blue-2` | `#1f7bff` / `#1460e0` | Primary buttons |
| `--purple` / `--purple-2` | `#8b5cf6` / `#6d3df0` | Wingman / assistant accents |
| `--green` | `#34e28a` | Validated, accepted, done |
| `--amber` | `#f5c542` | Attention, proposed, capacity warning |
| `--red` | `#ff4d5a` | Rejected, MICAP, destructive |
| `--text` / `--muted` / `--dim` | `#e8f2ff` / `#8aa3bd` / `#5d758e` | Text hierarchy |

Rules: status color always paired with a label or icon (never color alone). `--dim` is for decoration and disabled only — it does not meet 4.5:1 for body text. The theme is dark-only (`color-scheme: dark`); a light theme is out of scope.

Stage tags (`.tag.stage-<id>`) each carry a distinct hue so the six stages are distinguishable at a glance in lists; keep the mapping stable everywhere.

### 4.2 Typography

| Role | Family | Weights |
| --- | --- | --- |
| Display (hero headline, wordmark, stage titles) | Barlow Condensed | 600, 700 |
| Headings and labels | Barlow | 500–700 |
| UI and body | IBM Plex Sans | 400–600 |

Base size 15 px. Headline pairs a plain line with an emphasized cyan italic line ("From an idea / *to a mission-ready solution.*") — reuse this two-tone pattern sparingly (hero, community spotlight). Eyebrows: small caps-style uppercase, letter-spaced, `--muted`. Numbers in tables use tabular figures.

### 4.3 Layout and spacing

- App grid: 300 px sidebar (`--sidebar-w`) + fluid main; 64 px top bar (`--topbar-h`).
- Hero: 340 px expanded (`--hero-h`), 76 px band collapsed (`--hero-band-h`); art anchored right, faded into the headline on the left (about 4.8:1 aspect).
- Panels: 10 px radius (`--radius`), 1 px `--line` border, translucent `--card` over the stage art.
- Breakpoints in use: 1720 (band shows pipeline only), 1400 / 1280 / 1180 / 1100 (grid columns step down), 900 (sidebar becomes a drawer), 800 (gallery 2-up), 560 (single column, compact top bar).
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48.

### 4.4 Imagery and iconography

- Stage photography (`client/public/stages/*.jpg`) — real hardware, people at work, cool grade to sit on navy.
- Gallery category illustrations (`client/public/gallery/*.svg`) — line-art, single accent per category tone.
- Wingman portraits (`client/public/wingmen/*.jpg`) — consistent framing, circular crop.
- Icons: Lucide, 14–18 px, 1.75–2 px stroke; the Idea Forge gear mark uses 2.4 stroke.
- Brand: U.S. Air Force lockup top of sidebar; Idea Forge mark (gear + "Idea *Forge*") beneath; "Built on the Unified Mission Workbench" in the sidebar foot. Follow the service's brand guidance for the lockup; do not recolor it.

### 4.5 Motion

Short and functional: 150–250 ms ease-out for hover, panel open, hero collapse. Toast slides up. No looping animation except loading indicators. All motion disabled under `prefers-reduced-motion` (already implemented).

## 5. Components (inventory and direction)

| Component | Exists | Direction |
| --- | --- | --- |
| Sidebar + rail | ✔ | Add active-project shortcut under Workspace when a project is open. |
| Top bar + search | ✔ | Search results page grouped by type; keyboard shortcut `/` to focus. |
| Identity cluster (Wingman, service, bell, user) | ✔ | Bell shows count badge; user menu with sign-in identity details. |
| Hero + pipeline + collapse tab | ✔ | Pipeline shows per-stage project counts in the expanded hero. |
| Project card (six-dot progress) | ✔ | Add team avatars (max 3 + n). |
| Gallery card, Challenge card | ✔ | Real data, "View all" pages. |
| Stage header (image, eyebrow, title, summary, "Carried by") | ✔ | Add entry-criteria checklist and Move-to-next button. |
| Community picker, spotlight, project board | ✔ | Membership button (Join / Following). |
| Project workspace header + tabs | ✔ | Persist; add stage-move control and owner chip. |
| Team roster, open roles | ✔ | Directory person picker; invite states (Invited, Accepted, Declined). |
| Requirements table | — | ID, text, status chip, version, linked features count, reviewer, last change. |
| Traceability matrix | — | Rows = accepted requirements; columns = linked features, status, by, when; gaps highlighted amber. |
| File list | — | Name, type icon, revision, size, uploaded by/when; open in CAD for CAD types. |
| Discussion thread | — | Plain threaded messages, @mentions, no reactions in v1. |
| Milestones | — | Simple dated list tied to stages. |
| Capability card / quote form | — | Process, materials, site, lead time; quote status chips. |
| CAD workspace | ✔ | Unchanged from UMW; ensure status chip colors match tokens above. |
| Modal, toast, empty state, concept note | ✔ | Keep copy rules in [App flow §5](03-app-flow.md#5-empty-loading-and-error-states). |

## 6. Voice and copy

- Address the user directly; verbs first: "Start My Own Project", "Validate", "Request quote".
- Sentence case everywhere except the product name, stage names and proper nouns.
- Units and ranks as the field writes them: "MSgt R. Delgado", "436 MXG", "−20 °F", "270-day lead time".
- Errors: what happened + that nothing changed + what to do. Example: "The review trail could not be reached. Nothing was changed."
- Concept labels: "This stage is in the concept. Its working tools land in a later slice."
- Avoid: "Oops", exclamation marks, marketing superlatives inside the product (the hero copy is the one place for aspiration).

## 7. Accessibility

WCAG 2.1 AA. Visible 2 px cyan focus ring (`:focus-visible`). All icon-only buttons have `aria-label` (current pattern). Modals trap focus, close on Escape, restore focus. Pipeline is an ordered list with the current stage announced. Tables have header cells. Minimum hit target 32 px on desktop, 44 px under 900 px. Status is never conveyed by color alone.

## 8. Deliverables requested from design

1. Project workspace: all six tabs, populated and empty.
2. Requirements table and traceability matrix (Validate).
3. Stage page with entry-criteria checklist and stage-move flow (including blocked state).
4. Search results page.
5. Produce: capability directory and quote flow.
6. Field: fielding and impact entry.
7. Mobile (≤ 560 px) for Home, Project Overview, Team, and the decisions panel.
8. Updated hero with per-stage counts.

Deliver in Figma using the tokens above as variables; hand off annotated with token names, not hex values.

## 9. Out of scope

Light theme, custom illustration set beyond the gallery categories, marketing site, print styles beyond the CAD drawing (already generated by the CAD engine).
