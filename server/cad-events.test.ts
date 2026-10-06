// Integration tests for the CAD review trail against a real Postgres.
// Set CAD_TEST_DATABASE_URL (CI runs a postgres:16 service); skipped otherwise.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { CadEventStore, CadInputError, TABLE, identify, parseAction, type Actor } from "./cad-events";
import { registerCadRoutes, type RouteHost } from "./cad-routes";

const url = process.env.CAD_TEST_DATABASE_URL;
if (process.env.CI && !url) throw new Error("CAD_TEST_DATABASE_URL must be set in CI so the Postgres tests run");
const alice: Actor = { id: "1001", email: "alice@example.mil" };
const bob: Actor = { id: "1002", email: "bob@example.mil" };
const hole = "Upright (Part001)#Hole001";

describe("CAD review trail (Postgres)", { skip: !url && "set CAD_TEST_DATABASE_URL to run" }, () => {
  let pool: pg.Pool;
  let store: CadEventStore;
  let n = 0;
  const scope = () => ({ project: "opp-c17-hinge", model: `bracket.stp|8|1234|${(++n).toString(16)}` });

  before(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    await pool.query("DROP SCHEMA IF EXISTS foundry CASCADE");
    store = new CadEventStore(pool);
    await store.ensureSchema();
    await store.ensureSchema(); // idempotent
  });
  after(async () => {
    await pool?.end();
  });

  test("records reviews and links with the actor, skipping no-ops", async () => {
    const { project, model } = scope();
    assert.equal((await store.record(project, model, { kind: "review", feature: hole, to: "Validated" }, alice)).changed, true);
    assert.equal((await store.record(project, model, { kind: "review", feature: hole, to: "Validated" }, bob)).changed, false);
    await store.record(project, model, { kind: "link", feature: hole, requirement: "REQ-002" }, alice);
    assert.equal((await store.record(project, model, { kind: "link", feature: hole, requirement: "REQ-002" }, bob)).changed, false);
    assert.equal((await store.record(project, model, { kind: "unlink", feature: hole, requirement: "REQ-009" }, bob)).changed, false);
    const { events } = await store.record(project, model, { kind: "review", feature: hole, to: "Rejected" }, bob);
    assert.deepEqual(
      events.map((e) => (e.kind === "review" ? `${e.by} ${e.from}>${e.to}` : `${e.by} ${e.kind} ${e.requirement}`)),
      ["alice@example.mil Inferred>Validated", "alice@example.mil link REQ-002", "bob@example.mil Validated>Rejected"],
    );
    assert.ok(events.every((e) => !Number.isNaN(Date.parse(e.at))));
    assert.deepEqual(await store.list(project, model), events);
  });

  test("trails are kept per project and model", async () => {
    const a = scope();
    const b = scope();
    await store.record(a.project, a.model, { kind: "review", feature: hole, to: "Validated" }, alice);
    assert.equal((await store.list(b.project, b.model)).length, 0);
    assert.equal((await store.list("another-project", a.model)).length, 0);
  });

  test("concurrent writers are serialized: one transition, correct 'from'", async () => {
    const { project, model } = scope();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.record(project, model, { kind: "review", feature: hole, to: "Validated" }, i % 2 ? alice : bob)),
    );
    assert.equal(results.filter((r) => r.changed).length, 1);
    await Promise.all([
      store.record(project, model, { kind: "review", feature: hole, to: "Rejected" }, alice),
      store.record(project, model, { kind: "review", feature: hole, to: "Inferred" }, bob),
    ]);
    const reviews = (await store.list(project, model)).filter((e) => e.kind === "review");
    // Each transition starts where the previous one ended.
    for (let i = 1; i < reviews.length; i++) {
      const [prev, cur] = [reviews[i - 1], reviews[i]];
      assert.ok(prev.kind === "review" && cur.kind === "review" && cur.from === prev.to);
    }
  });

  test("the table is append-only", async () => {
    const { project, model } = scope();
    await store.record(project, model, { kind: "review", feature: hole, to: "Validated" }, alice);
    await assert.rejects(pool.query(`UPDATE ${TABLE} SET actor_email = 'mallory@example.mil'`), /append-only/);
    await assert.rejects(pool.query(`DELETE FROM ${TABLE}`), /append-only/);
    await assert.rejects(pool.query(`TRUNCATE ${TABLE}`), /append-only/);
    await assert.rejects(
      pool.query(`INSERT INTO ${TABLE} (project, model_key, feature, kind, from_status, to_status, actor_id) VALUES ('p','m','f','review','Validated','Validated','x')`),
      /check constraint/,
    );
  });

  test("routes attribute writes to the signed-in user and refuse anonymous writes", async () => {
    const routes = new Map<string, (req: any, res: any) => unknown>();
    const host: RouteHost = {
      get: (p, h) => routes.set(`GET ${p}`, h),
      post: (p, h) => routes.set(`POST ${p}`, h),
    };
    registerCadRoutes(host, store, () => {});
    const call = async (key: string, opts: { headers?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => {
      let status = 200;
      let body: any;
      const res = { status: (c: number) => ((status = c), res), json: (b: unknown) => ((body = b), res), setHeader: () => res };
      const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      await routes.get(key)!({ header: (n: string) => headers[n.toLowerCase()], query: opts.query ?? {}, body: opts.body }, res);
      return { status, body };
    };
    const signedIn = { "X-Forwarded-User": "1001", "X-Forwarded-Email": "alice@example.mil" };
    const { project, model } = scope();

    const status = await call("GET /api/cad/status", { headers: signedIn });
    assert.deepEqual(status.body, { store: "lakebase", user: { id: "1001", email: "alice@example.mil" } });

    // The body cannot choose the actor or the "from" status.
    const ok = await call("POST /api/cad/events", {
      headers: signedIn,
      body: { project, model, action: { kind: "review", feature: hole, to: "Validated", from: "Rejected", by: "mallory" } },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(
      ok.body.events.map((e: any) => [e.by, e.from, e.to]),
      [["alice@example.mil", "Inferred", "Validated"]],
    );

    const anon = await call("POST /api/cad/events", { body: { project, model, action: { kind: "review", feature: hole, to: "Rejected" } } });
    assert.equal(anon.status, 401);
    assert.equal((await call("GET /api/cad/events", { query: { project, model } })).status, 401);

    const bad = await call("POST /api/cad/events", { headers: signedIn, body: { project, model, action: { kind: "review", feature: hole, to: "Approved" } } });
    assert.equal(bad.status, 400);

    const list = await call("GET /api/cad/events", { headers: signedIn, query: { project, model } });
    assert.equal(list.body.events.length, 1);
  });
});

describe("CAD review trail (no database)", () => {
  test("identity comes from the Databricks Apps headers", () => {
    const h = (m: Record<string, string>) => ({ header: (n: string) => m[n] });
    assert.deepEqual(identify(h({ "x-forwarded-user": "42", "x-forwarded-email": "a@b.mil" }), {}), { id: "42", email: "a@b.mil" });
    assert.deepEqual(identify(h({ "x-forwarded-user": "42", "x-forwarded-preferred-username": "a@b.mil" }), {}), { id: "42", email: "a@b.mil" });
    assert.equal(identify(h({ "x-forwarded-email": "a@b.mil" }), {}), null);
    assert.equal(identify(h({}), { NODE_ENV: "production" }), null);
    assert.equal(identify(h({}), { NODE_ENV: "development" })?.id, "local-dev");
  });

  test("actions are validated", () => {
    assert.deepEqual(parseAction({ kind: "link", feature: hole, requirement: "REQ-002", by: "x" }), { kind: "link", feature: hole, requirement: "REQ-002" });
    for (const bad of [null, {}, { kind: "review", feature: hole }, { kind: "delete", feature: hole }, { kind: "link", feature: "", requirement: "R" }, { kind: "link", feature: hole, requirement: "R".repeat(101) }]) {
      assert.throws(() => parseAction(bad), CadInputError);
    }
  });

  test("routes report browser storage when Lakebase is not configured", () => {
    const routes = new Map<string, (req: any, res: any) => unknown>();
    registerCadRoutes({ get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) }, null);
    assert.deepEqual([...routes.keys()], ["GET /api/cad/status"]);
    let body: unknown;
    const res = { status: () => res, json: (b: unknown) => ((body = b), res), setHeader: () => res };
    routes.get("GET /api/cad/status")!({ header: () => undefined, query: {} }, res);
    assert.deepEqual(body, { store: "browser" });
  });
});
