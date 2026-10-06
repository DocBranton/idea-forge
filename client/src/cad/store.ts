// Where CAD review sessions are kept.
// - BrowserSessionStore: this browser's localStorage. Per user, per machine, not shared.
// - RemoteSessionStore: the shared review trail in Lakebase, through /api/cad. Every
//   action is attributed by the server to the signed-in Databricks user.
// chooseSessionStore() picks the shared trail when the server has Lakebase configured.
import type { ReviewStatus } from "./engine/types";
import { HISTORY_LIMIT, applyAction, emptySession, replay, type CadAction, type CadSession, type HistoryEntry } from "./links";

export interface SessionStore {
  /** Plain-language description for the UI, e.g. "Saved in this browser only". */
  readonly label: string;
  /** True when reviews are shared with the team and attributed to the signed-in user. */
  readonly shared: boolean;
  /** Saved session for a project's model, or null if there is none. Rejects if the store can't be reached. */
  load(project: string, modelKey: string): Promise<CadSession | null>;
  /**
   * Apply one engineer action. Resolves with the session to show; `saved` is false if
   * the change is kept only in memory. Rejects (and changes nothing) if a shared
   * store refuses or can't be reached.
   */
  record(project: string, modelKey: string, action: CadAction, current: CadSession): Promise<{ session: CadSession; saved: boolean }>;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const VERSION = 1;
const STATUSES: ReadonlySet<string> = new Set<ReviewStatus>(["Inferred", "Validated", "Rejected"]);

function browserStorage(): KV | null {
  try {
    const s = globalThis.localStorage;
    const probe = "foundry:cad:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";

/** Keep only well-formed data; anything else is dropped rather than trusted. */
export function parseSession(raw: unknown): CadSession | null {
  if (!isObj(raw) || raw.v !== VERSION || !isObj(raw.session)) return null;
  const src = raw.session;
  const out = emptySession();
  const reviews: Record<string, ReviewStatus> = {};
  if (isObj(src.reviews)) {
    for (const [k, v] of Object.entries(src.reviews)) if (isStr(v) && STATUSES.has(v)) reviews[k] = v as ReviewStatus;
  }
  const links: Record<string, string[]> = {};
  if (isObj(src.links)) {
    for (const [k, v] of Object.entries(src.links)) {
      const ids = Array.isArray(v) ? [...new Set(v.filter(isStr))].sort() : [];
      if (ids.length) links[k] = ids;
    }
  }
  const history = Array.isArray(src.history) ? parseHistory(src.history) : [];
  return { ...out, reviews, links, history: history.slice(-HISTORY_LIMIT) };
}

/** Keep only well-formed history entries. */
export function parseHistory(raw: readonly unknown[]): HistoryEntry[] {
  const history: HistoryEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || !isStr(e.at) || !isStr(e.feature)) continue;
    const by = isStr(e.by) ? { by: e.by } : {};
    if (e.kind === "review" && isStr(e.from) && isStr(e.to) && STATUSES.has(e.from) && STATUSES.has(e.to)) {
      history.push({ at: e.at, feature: e.feature, kind: "review", from: e.from as ReviewStatus, to: e.to as ReviewStatus, ...by });
    } else if ((e.kind === "link" || e.kind === "unlink") && isStr(e.requirement)) {
      history.push({ at: e.at, feature: e.feature, kind: e.kind, requirement: e.requirement, ...by });
    }
  }
  return history;
}

export class BrowserSessionStore implements SessionStore {
  readonly label = "Saved in this browser only";
  readonly shared = false;
  constructor(private readonly kv: KV | null = browserStorage()) {}

  static key(project: string, modelKey: string): string {
    return `foundry:cad:v${VERSION}:${project}:${modelKey}`;
  }

  read(project: string, modelKey: string): CadSession | null {
    if (!this.kv) return null;
    try {
      const text = this.kv.getItem(BrowserSessionStore.key(project, modelKey));
      return text ? parseSession(JSON.parse(text)) : null;
    } catch {
      return null;
    }
  }

  /** Returns false if the session could not be saved (storage full or blocked). */
  save(project: string, modelKey: string, session: CadSession): boolean {
    if (!this.kv) return false;
    try {
      this.kv.setItem(BrowserSessionStore.key(project, modelKey), JSON.stringify({ v: VERSION, savedAt: new Date().toISOString(), session }));
      return true;
    } catch {
      return false;
    }
  }

  async load(project: string, modelKey: string): Promise<CadSession | null> {
    return this.read(project, modelKey);
  }

  async record(project: string, modelKey: string, action: CadAction, current: CadSession) {
    const session = applyAction(current, action);
    const saved = session === current || this.save(project, modelKey, session);
    return { session, saved };
  }
}

type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export class CadStoreError extends Error {}

// window.fetch must be called unbound (calling it as a method of another object throws
// "Illegal invocation"), so wrap it rather than storing the function itself.
const defaultFetch: Fetch = (input, init) => (globalThis.fetch as unknown as Fetch)(input, init);

async function readJson(res: Awaited<ReturnType<Fetch>>): Promise<Record<string, unknown>> {
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = isObj(body) && isStr(body.error) ? body.error : `The review trail returned an error (${res.status}).`;
    throw new CadStoreError(msg);
  }
  if (!isObj(body)) throw new CadStoreError("The review trail sent an unexpected response.");
  return body;
}

const eventsOf = (body: Record<string, unknown>): HistoryEntry[] => {
  if (!Array.isArray(body.events)) throw new CadStoreError("The review trail sent an unexpected response.");
  return parseHistory(body.events);
};

/** The shared review trail in Lakebase. The server records who made each change. */
export class RemoteSessionStore implements SessionStore {
  readonly shared = true;
  readonly label: string;
  constructor(
    private readonly base: string,
    readonly user: string | null,
    private readonly fetchImpl: Fetch = defaultFetch,
  ) {
    this.label = user ? `Shared in Lakebase · recorded as ${user}` : "Shared in Lakebase";
  }

  async load(project: string, modelKey: string): Promise<CadSession | null> {
    const q = new URLSearchParams({ project, model: modelKey });
    const res = await this.fetchImpl(`${this.base}api/cad/events?${q}`, { headers: { accept: "application/json" } });
    const events = eventsOf(await readJson(res));
    return events.length ? replay(events) : null;
  }

  async record(project: string, modelKey: string, action: CadAction) {
    const res = await this.fetchImpl(`${this.base}api/cad/events`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project, model: modelKey, action }),
    });
    // The server returns the whole trail, so changes by teammates show up too.
    return { session: replay(eventsOf(await readJson(res))), saved: true };
  }
}

/**
 * Ask the server which store is active. Anything other than a Lakebase answer (no
 * server, static hosting, an error) means browser storage.
 */
export async function chooseSessionStore(base = "/", fetchImpl: Fetch = defaultFetch): Promise<SessionStore> {
  try {
    const res = await fetchImpl(`${base}api/cad/status`, { headers: { accept: "application/json" } });
    const body = await readJson(res);
    if (body.store === "lakebase") {
      const u = isObj(body.user) ? body.user : null;
      const name = u && isStr(u.email) ? u.email : u && isStr(u.id) ? u.id : null;
      return new RemoteSessionStore(base, name, fetchImpl);
    }
  } catch {
    // fall through
  }
  return new BrowserSessionStore();
}
