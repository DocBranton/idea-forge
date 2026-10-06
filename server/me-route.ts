// GET /api/me — who is signed in, from the Databricks Apps headers. Never from the browser.
// Uses the same structural Express types as cad-routes so it needs no express typings.
import { identify } from "./cad-events";
import type { RouteHost } from "./cad-routes";

export function registerMeRoute(app: RouteHost): void {
  app.get("/api/me", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const user = identify(req);
    res.json(user ? { id: user.id, email: user.email ?? null } : null);
  });
}
