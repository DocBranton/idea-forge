import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserSessionStore, CadStoreError, RemoteSessionStore, chooseSessionStore, parseSession } from "./store";
import { HISTORY_LIMIT, emptySession, featureKey, geometryHash, historyFor, modelKey, recordLink, recordReview, replay, type HistoryEntry } from "./links";

const hole = featureKey("Upright (Part001)", "Hole001");
const T = "2026-10-04T23:55:00.000Z";

function memoryKV() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

test("reviews and links append to the history", () => {
  let s = emptySession();
  s = recordReview(s, hole, "Validated", T);
  s = recordReview(s, hole, "Validated", T); // no-op
  s = recordLink(s, hole, "REQ-002", true, T);
  s = recordLink(s, hole, "REQ-002", true, T); // no-op
  s = recordLink(s, hole, "REQ-002", false, T);
  s = recordReview(s, hole, "Inferred", T);
  assert.deepEqual(
    historyFor(s, hole).map((e) => (e.kind === "review" ? `${e.from}>${e.to}` : `${e.kind} ${e.requirement}`)),
    ["Inferred>Validated", "link REQ-002", "unlink REQ-002", "Validated>Inferred"],
  );
  // Returning to Inferred clears the stored status; the history keeps it.
  assert.equal(hole in s.reviews, false);
  assert.deepEqual(s.links, {});
});

test("history is capped", () => {
  let s = emptySession();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = recordReview(s, hole, i % 2 ? "Inferred" : "Validated", T);
  assert.equal(s.history.length, HISTORY_LIMIT);
});

test("sessions round-trip through the store, per project and model", () => {
  const kv = memoryKV();
  const store = new BrowserSessionStore(kv);
  let s = recordReview(emptySession(), hole, "Validated", T);
  s = recordLink(s, hole, "REQ-002", true, T);
  assert.equal(store.save("opp-c17-hinge", "m1", s), true);
  assert.deepEqual(store.read("opp-c17-hinge", "m1"), s);
  assert.equal(store.read("opp-c17-hinge", "m2"), null);
  assert.equal(store.read("opp-other", "m1"), null);
});

test("malformed or foreign data is dropped, not trusted", () => {
  assert.equal(parseSession(null), null);
  assert.equal(parseSession({ v: 99, session: {} }), null);
  const s = parseSession({
    v: 1,
    session: {
      reviews: { [hole]: "Validated", x: "Approved", y: 3 },
      links: { [hole]: ["REQ-002", "REQ-002", 7], z: [] },
      history: [{ at: T, feature: hole, kind: "review", from: "Inferred", to: "Validated" }, { kind: "delete-all" }, "junk"],
    },
  });
  assert.ok(s);
  assert.deepEqual(s.reviews, { [hole]: "Validated" });
  assert.deepEqual(s.links, { [hole]: ["REQ-002"] });
  assert.equal(s.history.length, 1);
});

test("a full or blocked store reports failure instead of throwing", () => {
  const store = new BrowserSessionStore({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  });
  assert.equal(store.save("p", "m", emptySession()), false);
  assert.equal(store.read("p", "m"), null);
  assert.equal(new BrowserSessionStore(null).save("p", "m", emptySession()), false);
});

test("model key includes a geometry hash that changes with the geometry", () => {
  const a = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const b = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1.0001, 0]);
  const ha = geometryHash([a]), hb = geometryHash([b]);
  assert.match(ha, /^[0-9a-f]{8}$/);
  assert.notEqual(ha, hb);
  assert.equal(geometryHash([a]), ha);
  assert.equal(modelKey("part.stp", 1, 1, ha), `part.stp|1|1|${ha}`);
});

test("browser store applies actions and reports when it can't save", async () => {
  const kv = memoryKV();
  const store = new BrowserSessionStore(kv);
  const r = await store.record("p", "m", { kind: "review", feature: hole, to: "Validated" }, emptySession());
  assert.equal(r.saved, true);
  assert.equal(r.session.reviews[hole], "Validated");
  assert.deepEqual(await store.load("p", "m"), r.session);
  const blocked = new BrowserSessionStore(null);
  const b = await blocked.record("p", "m", { kind: "link", feature: hole, requirement: "REQ-002" }, emptySession());
  assert.equal(b.saved, false);
  assert.deepEqual(b.session.links, { [hole]: ["REQ-002"] });
});

test("replaying the shared trail rebuilds reviews, links and attributed history", () => {
  const events: HistoryEntry[] = [
    { at: T, feature: hole, kind: "review", from: "Inferred", to: "Validated", by: "alice@example.mil" },
    { at: T, feature: hole, kind: "link", requirement: "REQ-002", by: "alice@example.mil" },
    { at: T, feature: hole, kind: "link", requirement: "REQ-003", by: "bob@example.mil" },
    { at: T, feature: hole, kind: "unlink", requirement: "REQ-002", by: "bob@example.mil" },
  ];
  const s = replay(events);
  assert.deepEqual(s.reviews, { [hole]: "Validated" });
  assert.deepEqual(s.links, { [hole]: ["REQ-003"] });
  assert.deepEqual(s.history, events);
});

function fakeServer(handler: (url: string, init?: { method?: string; body?: string }) => { status?: number; body: unknown; type?: string }) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    const r = handler(url, init);
    const status = r.status ?? 200;
    return { ok: status < 400, status, headers: { get: () => r.type ?? "application/json" }, json: async () => r.body };
  };
  return { calls, fetchImpl };
}

test("chooses the shared trail only when the server says Lakebase", async () => {
  const lake = fakeServer(() => ({ body: { store: "lakebase", user: { id: "1001", email: "alice@example.mil" } } }));
  const s1 = await chooseSessionStore("/foundry/", lake.fetchImpl);
  assert.ok(s1 instanceof RemoteSessionStore);
  assert.equal(s1.shared, true);
  assert.equal(s1.label, "Shared in Lakebase · recorded as alice@example.mil");
  assert.equal(lake.calls[0].url, "/foundry/api/cad/status");

  for (const reply of [
    { body: { store: "browser" } },
    { status: 404, body: null, type: "text/html" },
    { body: "<!doctype html>", type: "text/html" }, // SPA fallback
  ]) {
    const s = await chooseSessionStore("/", fakeServer(() => reply).fetchImpl);
    assert.ok(s instanceof BrowserSessionStore);
  }
  const offline = await chooseSessionStore("/", async () => {
    throw new Error("offline");
  });
  assert.ok(offline instanceof BrowserSessionStore);
});

test("shared trail sends actions without an actor and shows the server's answer", async () => {
  const trail: HistoryEntry[] = [];
  const srv = fakeServer((url, init) => {
    if (init?.method === "POST") {
      const { action } = JSON.parse(init.body ?? "{}");
      trail.push({ at: T, feature: action.feature, kind: "review", from: "Inferred", to: action.to, by: "alice@example.mil" });
    }
    return { body: { events: trail } };
  });
  const store = new RemoteSessionStore("/", "alice@example.mil", srv.fetchImpl);
  assert.equal(await store.load("p", "m"), null);
  const r = await store.record("p", "m", { kind: "review", feature: hole, to: "Validated" });
  assert.equal(r.saved, true);
  assert.equal(r.session.reviews[hole], "Validated");
  assert.equal(r.session.history[0].by, "alice@example.mil");
  const post = srv.calls.find((c) => c.method === "POST")!;
  assert.deepEqual(post.body, { project: "p", model: "m", action: { kind: "review", feature: hole, to: "Validated" } });
  assert.equal(srv.calls[0].url, "/api/cad/events?project=p&model=m");
});

test("shared trail failures reject with the server's message", async () => {
  const store = new RemoteSessionStore("/", null, fakeServer(() => ({ status: 401, body: { error: "Sign in to record reviews." } })).fetchImpl);
  await assert.rejects(store.record("p", "m", { kind: "review", feature: hole, to: "Validated" }), (e: unknown) => e instanceof CadStoreError && /Sign in/.test(e.message));
  const bad = new RemoteSessionStore("/", null, fakeServer(() => ({ body: { nope: 1 } })).fetchImpl);
  await assert.rejects(bad.load("p", "m"), CadStoreError);
});

test("the default fetch is called unbound, as browsers require", async () => {
  const real = globalThis.fetch;
  let sawThis: unknown = "unset";
  (globalThis as { fetch: unknown }).fetch = function (this: unknown) {
    sawThis = this;
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ events: [] }) });
  };
  try {
    await new RemoteSessionStore("/", null).load("p", "m");
    assert.ok(sawThis === undefined || sawThis === globalThis, "fetch must not be called as a method of the store");
  } finally {
    globalThis.fetch = real;
  }
});
