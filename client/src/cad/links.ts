// Links between recognized CAD features and requirements, plus the per-model review
// session. Pure data, no three.js, so the Engineering view can use it without
// loading the CAD chunk.
//
// Linking records traceability only. It never changes a feature's review status or a
// requirement's status; engineers set those explicitly.
import type { ReviewStatus } from "./engine/types";

/** "<part name>#<feature name>", e.g. "Upright (Part001)#Hole001". */
export type FeatureKey = string;
export type LinkMap = Readonly<Record<FeatureKey, readonly string[]>>;

/** One engineer action, kept append-only so review history can be audited. */
export type HistoryEntry =
  | { at: string; feature: FeatureKey; kind: "review"; from: ReviewStatus; to: ReviewStatus; by?: string }
  | { at: string; feature: FeatureKey; kind: "link" | "unlink"; requirement: string; by?: string };

export interface CadSession {
  reviews: Readonly<Record<FeatureKey, ReviewStatus>>;
  links: LinkMap;
  history: readonly HistoryEntry[];
}

/** Older entries are dropped past this many per model. */
export const HISTORY_LIMIT = 500;

export const emptySession = (): CadSession => ({ reviews: {}, links: {}, history: [] });

const appendHistory = (h: readonly HistoryEntry[], e: HistoryEntry) => [...h, e].slice(-HISTORY_LIMIT);

/** Set a feature's review status and record the change. No-op if unchanged. */
export function recordReview(s: CadSession, key: FeatureKey, to: ReviewStatus, at = new Date().toISOString(), by?: string): CadSession {
  const from = s.reviews[key] ?? "Inferred";
  if (from === to) return s;
  const reviews = { ...s.reviews, [key]: to };
  if (to === "Inferred") delete reviews[key];
  return { ...s, reviews, history: appendHistory(s.history, { at, feature: key, kind: "review", from, to, ...(by ? { by } : {}) }) };
}

/** Add or remove a requirement link and record it. No-op if nothing changes. */
export function recordLink(s: CadSession, key: FeatureKey, requirement: string, add: boolean, at = new Date().toISOString(), by?: string): CadSession {
  const links = add ? addLink(s.links, key, requirement) : removeLink(s.links, key, requirement);
  if (links === s.links) return s;
  return { ...s, links, history: appendHistory(s.history, { at, feature: key, kind: add ? "link" : "unlink", requirement, ...(by ? { by } : {}) }) };
}

/** One engineer action on a feature, as sent to a store. */
export type CadAction =
  | { kind: "review"; feature: FeatureKey; to: ReviewStatus }
  | { kind: "link" | "unlink"; feature: FeatureKey; requirement: string };

export function applyAction(s: CadSession, a: CadAction, at?: string, by?: string): CadSession {
  return a.kind === "review" ? recordReview(s, a.feature, a.to, at, by) : recordLink(s, a.feature, a.requirement, a.kind === "link", at, by);
}

/** Rebuild a session from a full event list (oldest first), e.g. from the shared trail. */
export function replay(events: readonly HistoryEntry[]): CadSession {
  let s = emptySession();
  for (const e of events) {
    s = e.kind === "review" ? recordReview(s, e.feature, e.to, e.at, e.by) : recordLink(s, e.feature, e.requirement, e.kind === "link", e.at, e.by);
  }
  return s;
}

export function historyFor(s: CadSession, key: FeatureKey): HistoryEntry[] {
  return s.history.filter((e) => e.feature === key);
}

export const featureKey = (partName: string, featureName: string): FeatureKey => `${partName}#${featureName}`;

export function splitKey(key: FeatureKey): { part: string; feature: string } {
  const i = key.lastIndexOf("#");
  return i < 0 ? { part: key, feature: "" } : { part: key.slice(0, i), feature: key.slice(i + 1) };
}

/**
 * Identifies one loaded model; links and reviews are kept per model. The geometry
 * hash keeps a changed file with the same name from inheriting old reviews.
 */
export function modelKey(fileName: string, partCount: number, triangles: number, hash = ""): string {
  return `${fileName}|${partCount}|${triangles}${hash ? `|${hash}` : ""}`;
}

/** FNV-1a over the raw vertex data. Fast enough for multi-million-vertex models. */
export function geometryHash(arrays: readonly (Float32Array | Uint32Array)[]): string {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const words = new Uint32Array(a.buffer, a.byteOffset, a.length);
    for (let i = 0; i < words.length; i++) {
      h ^= words[i];
      h = Math.imul(h, 0x01000193);
    }
    h ^= words.length;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function addLink(links: LinkMap, key: FeatureKey, reqId: string): LinkMap {
  const cur = links[key] ?? [];
  if (cur.includes(reqId)) return links;
  return { ...links, [key]: [...cur, reqId].sort() };
}

export function removeLink(links: LinkMap, key: FeatureKey, reqId: string): LinkMap {
  const cur = links[key];
  if (!cur?.includes(reqId)) return links;
  const next = { ...links };
  const rest = cur.filter((r) => r !== reqId);
  if (rest.length) next[key] = rest;
  else delete next[key];
  return next;
}

/** Features linked to a requirement, in stable order. */
export function featuresFor(links: LinkMap, reqId: string): FeatureKey[] {
  return Object.keys(links)
    .filter((k) => links[k].includes(reqId))
    .sort();
}

/**
 * Drop links to features that don't exist in the loaded model, and to requirements
 * that no longer exist. Returns what was dropped so the UI can say so.
 */
export function pruneLinks(
  links: LinkMap,
  features: ReadonlySet<FeatureKey>,
  reqIds?: ReadonlySet<string>,
): { links: LinkMap; droppedFeatures: FeatureKey[]; droppedLinks: number } {
  const next: Record<FeatureKey, string[]> = {};
  const droppedFeatures: FeatureKey[] = [];
  let droppedLinks = 0;
  for (const [k, reqs] of Object.entries(links)) {
    if (!features.has(k)) {
      droppedFeatures.push(k);
      droppedLinks += reqs.length;
      continue;
    }
    const kept = reqIds ? reqs.filter((r) => reqIds.has(r)) : [...reqs];
    droppedLinks += reqs.length - kept.length;
    if (kept.length) next[k] = kept;
  }
  return { links: next, droppedFeatures: droppedFeatures.sort(), droppedLinks };
}

/**
 * The part of a session that applies to the loaded model: reviews and links for
 * features it has and requirements that exist. Nothing is deleted from the session
 * or its history; a shared trail is never rewritten by a view.
 */
export function visibleSession(s: CadSession, features: ReadonlySet<FeatureKey>, reqIds?: ReadonlySet<string>): CadSession {
  const links = pruneLinks(s.links, features, reqIds).links;
  const reviews = Object.fromEntries(Object.entries(s.reviews).filter(([k]) => features.has(k)));
  return { ...s, reviews, links };
}
