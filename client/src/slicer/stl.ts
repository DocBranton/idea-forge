// Binary STL from the CAD workspace's tessellated meshes, in millimetres.
// Kiri:Moto takes STL.
import type { MeshData, ModelData } from "../cad/engine/types";

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

const HEADER = 80;
const TRI = 50;

/** Number of triangles across the given meshes. */
export function triangleCount(meshes: readonly MeshData[]): number {
  return meshes.reduce((n, m) => n + Math.floor(m.index.length / 3), 0);
}

/**
 * Binary STL of `meshes` (default: every mesh in the model), scaled to millimetres.
 * Degenerate triangles are kept; slicers drop them.
 */
export function modelToStl(model: ModelData, meshes: readonly MeshData[] = model.meshes): ArrayBuffer {
  const k = model.mmPerUnit;
  const count = triangleCount(meshes);
  const buf = new ArrayBuffer(HEADER + 4 + count * TRI);
  const view = new DataView(buf);
  const label = `Idea Forge ${model.fileName}`.slice(0, HEADER);
  for (let i = 0; i < label.length; i++) view.setUint8(i, label.charCodeAt(i) & 0x7f);
  view.setUint32(HEADER, count, true);
  let o = HEADER + 4;
  for (const m of meshes) {
    const p = m.position;
    const idx = m.index;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const ax = p[a] * k, ay = p[a + 1] * k, az = p[a + 2] * k;
      const bx = p[b] * k, by = p[b + 1] * k, bz = p[b + 2] * k;
      const cx = p[c] * k, cy = p[c + 1] * k, cz = p[c + 2] * k;
      // Facet normal from the winding.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
        view.setFloat32(o, v, true);
        o += 4;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return buf;
}

/** Axis-aligned bounds of the given meshes, in millimetres. Null when there is no geometry. */
export function meshBounds(model: ModelData, meshes: readonly MeshData[] = model.meshes): MeshBounds | null {
  const k = model.mmPerUnit;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const m of meshes) {
    const p = m.position;
    for (let i = 0; i + 2 < p.length; i += 3) {
      any = true;
      for (let a = 0; a < 3; a++) {
        const v = p[i + a] * k;
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
  }
  return any ? { min, max } : null;
}
