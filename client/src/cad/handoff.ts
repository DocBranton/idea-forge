// The part most recently opened in the CAD workspace, so later stages (Produce's slicer)
// can pick it up without the engineer opening the file again. Kept in memory for this
// page only; files never leave the browser.
import type { ModelData } from "./engine/types";

export interface HandoffPart {
  model: ModelData;
  openedAt: Date;
}

let current: HandoffPart | null = null;
const listeners = new Set<(p: HandoffPart | null) => void>();

export function publishModel(model: ModelData): void {
  current = { model, openedAt: new Date() };
  for (const fn of listeners) fn(current);
}

export function currentModel(): HandoffPart | null {
  return current;
}

/** Subscribe to new parts; returns the unsubscribe function. */
export function onModel(fn: (p: HandoffPart | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
