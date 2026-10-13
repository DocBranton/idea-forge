// Final G-code from OrcaSlicer, which runs on the server (see server/orca.ts).
import type { SliceSettings } from "./profiles";

export interface OrcaStatus {
  available: boolean;
  /** Printer ids the server has Orca profiles for. */
  printers: string[];
  /** Why Orca is unavailable, in plain words. */
  reason?: string;
}

export async function orcaStatus(): Promise<OrcaStatus> {
  try {
    const res = await fetch("/api/slice/status", { headers: { Accept: "application/json" } });
    if (!res.ok) return { available: false, printers: [], reason: "The server did not answer." };
    const body = (await res.json()) as { orca?: OrcaStatus };
    return body.orca ?? { available: false, printers: [], reason: "This server does not slice with Orca." };
  } catch {
    return { available: false, printers: [], reason: "The server could not be reached." };
  }
}

/** Slice on the server with Orca. Rejects with a message the screen can show. */
export async function sliceWithOrca(stl: ArrayBuffer, settings: SliceSettings, fileName: string): Promise<{ gcode: string; ms: number }> {
  const t0 = performance.now();
  const res = await fetch("/api/slice/orca", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Slice-Settings": JSON.stringify(settings),
      "X-Slice-Name": encodeURIComponent(fileName),
    },
    body: stl,
  });
  if (!res.ok) {
    let message = `Orca could not slice the part (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return { gcode: await res.text(), ms: performance.now() - t0 };
}
