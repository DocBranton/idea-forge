import { createApp, lakebase, server } from "@databricks/appkit";
import { CadEventStore } from "./cad-events";
import { registerCadRoutes } from "./cad-routes";
import { registerMeRoute } from "./me-route";

// Idea Foundry server. The runtime and the CAD review trail come from UMW unchanged.
// Lakebase joins the app only when a postgres resource is configured (app.yaml sets
// LAKEBASE_ENDPOINT from it). Without it, CAD reviews stay in each browser.
const withLakebase = !!process.env.LAKEBASE_ENDPOINT;

createApp({
  plugins: [server(), ...(withLakebase ? [lakebase()] : [])],
  async onPluginsReady(appkit) {
    let store: CadEventStore | null = null;
    if ("lakebase" in appkit) {
      store = new CadEventStore(appkit.lakebase.pool);
      try {
        await store.ensureSchema();
        console.log("[cad] Review trail ready in Lakebase (foundry.cad_events)");
      } catch (err) {
        // Keep the routes: requests will fail loudly rather than fall back to browser storage.
        console.error("[cad] Could not set up foundry.cad_events:", (err as Error).message);
      }
    }
    appkit.server.extend((app) => {
      registerMeRoute(app);
      registerCadRoutes(app, store);
    });
  },
}).catch(console.error);
