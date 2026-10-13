import { createApp, lakebase, server } from "@databricks/appkit";
import { CadEventStore } from "./cad-events";
import { registerCadRoutes } from "./cad-routes";
import { registerMeRoute } from "./me-route";
import { orcaConfigFromEnv } from "./orca";
import { registerSliceRoutes } from "./slice-routes";

// Idea Forge server. The runtime and the CAD review trail come from UMW unchanged.
// Lakebase joins the app only when a postgres resource is configured (app.yaml sets
// LAKEBASE_ENDPOINT from it). Without it, CAD reviews stay in each browser.
// Orca slicing joins when ORCA_SLICER_BIN and ORCA_PROFILES_DIR are set (see orca.ts).
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
      registerSliceRoutes(app, orcaConfigFromEnv());
    });
  },
}).catch(console.error);
