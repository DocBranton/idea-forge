// Shared CAD review trail, stored in Lakebase (Postgres).
//
// Every engineer action on a recognized CAD feature (validate, reject, return to
// inferred, link or unlink a requirement) is appended to foundry.cad_events with the
// signed-in user who made it. Current review status and links are derived by
// replaying the events, so the trail and the state can never disagree.
//
// The actor always comes from the Databricks Apps identity headers, never from the
// request body, and the table rejects UPDATE, DELETE and TRUNCATE.

export const STATUSES = ["Inferred", "Validated", "Rejected"] as const;
export type ReviewStatus = (typeof STATUSES)[number];

export type CadAction =
  | { kind: "review"; feature: string; to: ReviewStatus }
  | { kind: "link" | "unlink"; feature: string; requirement: string };

export interface Actor {
  id: string;
  email?: string;
}

/** Wire format, matching the client's HistoryEntry. */
export type CadEvent =
  | { at: string; feature: string; kind: "review"; from: ReviewStatus; to: ReviewStatus; by: string }
  | { at: string; feature: string; kind: "link" | "unlink"; requirement: string; by: string };

/** The subset of pg.Pool this module uses; AppKit's lakebase.pool satisfies it. */
export interface Db {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  connect(): Promise<{ query(text: string, values?: unknown[]): Promise<{ rows: any[] }>; release(): void }>;
}

export const LIMITS = { project: 200, model: 1000, feature: 500, requirement: 100 } as const;

export class CadInputError extends Error {}

const str = (x: unknown, max: number, name: string): string => {
  if (typeof x !== "string" || !x.trim()) throw new CadInputError(`${name} is required`);
  if (x.length > max) throw new CadInputError(`${name} is too long`);
  return x;
};

export function parseScope(project: unknown, model: unknown): { project: string; model: string } {
  return { project: str(project, LIMITS.project, "project"), model: str(model, LIMITS.model, "model") };
}

/** Validate an action from a request body. Any "from" or "by" in the body is ignored. */
export function parseAction(raw: unknown): CadAction {
  if (typeof raw !== "object" || raw === null) throw new CadInputError("action is required");
  const a = raw as Record<string, unknown>;
  const feature = str(a.feature, LIMITS.feature, "feature");
  if (a.kind === "review") {
    if (typeof a.to !== "string" || !(STATUSES as readonly string[]).includes(a.to)) throw new CadInputError("to must be Inferred, Validated or Rejected");
    return { kind: "review", feature, to: a.to as ReviewStatus };
  }
  if (a.kind === "link" || a.kind === "unlink") {
    return { kind: a.kind, feature, requirement: str(a.requirement, LIMITS.requirement, "requirement") };
  }
  throw new CadInputError("kind must be review, link or unlink");
}

type HeaderSource = { header(name: string): string | undefined };

/**
 * The signed-in user, from the headers the Databricks Apps proxy sets on every
 * request. Outside Databricks (local development only) a fixed developer identity
 * is used so the flow can be exercised; in production a request without identity
 * is refused.
 */
export function identify(req: HeaderSource, env: Readonly<Record<string, string | undefined>> = process.env): Actor | null {
  const id = req.header("x-forwarded-user")?.trim();
  const email = req.header("x-forwarded-email")?.trim() || req.header("x-forwarded-preferred-username")?.trim();
  if (id) return { id, ...(email ? { email } : {}) };
  if (env.NODE_ENV === "development") return { id: "local-dev", email: env.CAD_DEV_USER || "local developer" };
  return null;
}

export const SCHEMA = "foundry";
export const TABLE = `${SCHEMA}.cad_events`;

const DDL = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
    id          BIGSERIAL PRIMARY KEY,
    project     TEXT NOT NULL,
    model_key   TEXT NOT NULL,
    feature     TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('review', 'link', 'unlink')),
    from_status TEXT CHECK (from_status IN ('Inferred', 'Validated', 'Rejected')),
    to_status   TEXT CHECK (to_status IN ('Inferred', 'Validated', 'Rejected')),
    requirement TEXT,
    actor_id    TEXT NOT NULL,
    actor_email TEXT,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
      (kind = 'review' AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status AND requirement IS NULL)
      OR (kind <> 'review' AND requirement IS NOT NULL AND from_status IS NULL AND to_status IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS cad_events_model ON ${TABLE} (project, model_key, id)`,
  `CREATE OR REPLACE FUNCTION ${SCHEMA}.cad_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'foundry.cad_events is append-only'; END $$`,
  `DROP TRIGGER IF EXISTS cad_events_no_change ON ${TABLE}`,
  `CREATE TRIGGER cad_events_no_change BEFORE UPDATE OR DELETE ON ${TABLE}
   FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.cad_events_append_only()`,
  `DROP TRIGGER IF EXISTS cad_events_no_truncate ON ${TABLE}`,
  `CREATE TRIGGER cad_events_no_truncate BEFORE TRUNCATE ON ${TABLE}
   FOR EACH STATEMENT EXECUTE FUNCTION ${SCHEMA}.cad_events_append_only()`,
];

interface Row {
  feature: string;
  kind: "review" | "link" | "unlink";
  from_status: ReviewStatus | null;
  to_status: ReviewStatus | null;
  requirement: string | null;
  actor_id: string;
  actor_email: string | null;
  at: Date | string;
}

const toEvent = (r: Row): CadEvent => {
  const at = r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString();
  const by = r.actor_email || r.actor_id;
  return r.kind === "review"
    ? { at, feature: r.feature, kind: "review", from: r.from_status as ReviewStatus, to: r.to_status as ReviewStatus, by }
    : { at, feature: r.feature, kind: r.kind, requirement: r.requirement as string, by };
};

const SELECT = `SELECT feature, kind, from_status, to_status, requirement, actor_id, actor_email, at
  FROM ${TABLE} WHERE project = $1 AND model_key = $2 ORDER BY id`;

export class CadEventStore {
  constructor(private readonly db: Db) {}

  /**
   * Create the schema on first start. Run as the app's service principal so it owns
   * the table (see the AppKit Lakebase docs: deploy before developing locally).
   */
  async ensureSchema(): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM information_schema.triggers WHERE event_object_schema = $1 AND event_object_table = 'cad_events' AND trigger_name = 'cad_events_no_truncate'`,
      [SCHEMA],
    );
    if (rows.length) return;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const stmt of DDL) await client.query(stmt);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async list(project: string, model: string): Promise<CadEvent[]> {
    const { rows } = await this.db.query(SELECT, [project, model]);
    return (rows as Row[]).map(toEvent);
  }

  /**
   * Append the action if it changes anything, attributed to the actor, and return the
   * model's full event list. A per-model advisory lock serializes concurrent writers
   * so "from" is always the status the change was actually made from.
   */
  async record(project: string, model: string, action: CadAction, actor: Actor): Promise<{ changed: boolean; events: CadEvent[] }> {
    const client = await this.db.connect();
    let changed = false;
    try {
      await client.query("BEGIN");
      // Length-prefixed so ("a|b", "c") and ("a", "b|c") get different keys.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended(length($1::text) || ':' || $1 || $2::text, 0))", [project, model]);
      if (action.kind === "review") {
        const { rows } = await client.query(
          `SELECT to_status FROM ${TABLE} WHERE project = $1 AND model_key = $2 AND feature = $3 AND kind = 'review' ORDER BY id DESC LIMIT 1`,
          [project, model, action.feature],
        );
        const from: ReviewStatus = rows[0]?.to_status ?? "Inferred";
        if (from !== action.to) {
          await client.query(
            `INSERT INTO ${TABLE} (project, model_key, feature, kind, from_status, to_status, actor_id, actor_email) VALUES ($1, $2, $3, 'review', $4, $5, $6, $7)`,
            [project, model, action.feature, from, action.to, actor.id, actor.email ?? null],
          );
          changed = true;
        }
      } else {
        const { rows } = await client.query(
          `SELECT kind FROM ${TABLE} WHERE project = $1 AND model_key = $2 AND feature = $3 AND requirement = $4 ORDER BY id DESC LIMIT 1`,
          [project, model, action.feature, action.requirement],
        );
        const linked = rows[0]?.kind === "link";
        if (linked !== (action.kind === "link")) {
          await client.query(
            `INSERT INTO ${TABLE} (project, model_key, feature, kind, requirement, actor_id, actor_email) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [project, model, action.feature, action.kind, action.requirement, actor.id, actor.email ?? null],
          );
          changed = true;
        }
      }
      const { rows } = await client.query(SELECT, [project, model]);
      await client.query("COMMIT");
      return { changed, events: (rows as Row[]).map(toEvent) };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}
