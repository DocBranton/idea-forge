// HTTP routes for the shared CAD review trail.
//   GET  /api/cad/status                     which store is active, and who is signed in
//   GET  /api/cad/events?project=&model=     the model's event list
//   POST /api/cad/events {project, model, action}
//        append an engineer action (attributed to the signed-in user); returns the event list
// Without Lakebase only /status is served, reporting { store: "browser" }, and the
// client keeps reviews in browser storage.
import { CadEventStore, CadInputError, identify, parseAction, parseScope } from "./cad-events";

// Structural types for the bits of Express used here.
interface Req {
  header(name: string): string | undefined;
  query: Record<string, unknown>;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}
type Handler = (req: Req, res: Res) => void | Promise<void>;
export interface RouteHost {
  get(path: string, handler: Handler): unknown;
  post(path: string, handler: Handler): unknown;
}

const fail = (res: Res, e: unknown, log: (msg: string, err: unknown) => void) => {
  if (e instanceof CadInputError) {
    res.status(400).json({ error: e.message });
    return;
  }
  log("[cad] request failed", e);
  res.status(500).json({ error: "The review trail could not be reached. Nothing was changed." });
};

export function registerCadRoutes(app: RouteHost, store: CadEventStore | null, log: (msg: string, err: unknown) => void = console.error): void {
  app.get("/api/cad/status", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const user = identify(req);
    res.json(store ? { store: "lakebase", user: user ? { id: user.id, email: user.email ?? null } : null } : { store: "browser" });
  });
  if (!store) return;

  app.get("/api/cad/events", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!identify(req)) {
        res.status(401).json({ error: "Sign in to view the review trail." });
        return;
      }
      const { project, model } = parseScope(req.query.project, req.query.model);
      res.json({ events: await store.list(project, model) });
    } catch (e) {
      fail(res, e, log);
    }
  });

  app.post("/api/cad/events", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const actor = identify(req);
      if (!actor) {
        res.status(401).json({ error: "Sign in to record reviews. Changes are attributed to the signed-in engineer." });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { project, model } = parseScope(body.project, body.model);
      const result = await store.record(project, model, parseAction(body.action), actor);
      res.json(result);
    } catch (e) {
      fail(res, e, log);
    }
  });
}
