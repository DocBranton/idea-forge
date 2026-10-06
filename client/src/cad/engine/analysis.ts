// Geometry analysis on triangulated solids, ported from c-engineering-workbench js/analysis.js.
//  - mass properties (volume, area, centroid, bounds)
//  - face segmentation (B-rep faces when available, normal-based region growing otherwise)
//  - face classification (plane / cylinder / freeform) by least-squares fitting
//  - feature recognition: holes, counterbores, stepped holes, fillets, bosses, hole patterns
// Confidence scores come from fit residuals, never from guesses.
import * as THREE from "three";
import type {
  BrepFace,
  BossFeature,
  CylinderFace,
  Face,
  Feature,
  FeatureCounters,
  FilletFeature,
  HoleFeature,
  MeshData,
  PartAnalysis,
  PatternFeature,
} from "./types";

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

function triVerts(pos: Float32Array, idx: Uint32Array, t: number): void {
  const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
  _a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
  _b.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
  _c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
}

const pad = (n: number) => String(n).padStart(3, "0");

/**
 * Report fitted sizes to 5 significant figures. Tessellation and float32 noise sit
 * around 1 part in 10^5–10^6, enough to flip the last displayed digit of a size that
 * lands on a rounding boundary (0.375 in = 9.525 mm). The fit RMS stays in the evidence.
 */
export function snapSig(x: number, sig = 5): number {
  if (!x || !Number.isFinite(x)) return x;
  const p = 10 ** (sig - 1 - Math.floor(Math.log10(Math.abs(x))));
  return Math.round(x * p) / p;
}
const deg = THREE.MathUtils.degToRad;

// ---------- mass properties ----------
export function massProps(pos: Float32Array, idx: Uint32Array) {
  let vol = 0, area = 0;
  const centroid = new THREE.Vector3();
  const box = new THREE.Box3();
  const triangles = idx.length / 3;
  for (let t = 0; t < triangles; t++) {
    triVerts(pos, idx, t);
    const v6 = _a.dot(_e1.copy(_b).cross(_c));
    vol += v6;
    centroid.x += v6 * (_a.x + _b.x + _c.x);
    centroid.y += v6 * (_a.y + _b.y + _c.y);
    centroid.z += v6 * (_a.z + _b.z + _c.z);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    area += _n.crossVectors(_e1, _e2).length() / 2;
  }
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(_a.set(pos[i], pos[i + 1], pos[i + 2]));
  const volume = vol / 6;
  if (Math.abs(vol) > 1e-12) centroid.divideScalar(vol * 4);
  else box.getCenter(centroid);
  // A signed volume larger than the bounds (or ~zero) means the mesh isn't a closed solid.
  const size = box.getSize(new THREE.Vector3());
  const closed = Math.abs(volume) > 1e-9 && Math.abs(volume) <= size.x * size.y * size.z * 1.0001;
  return { volume: Math.abs(volume), area, centroid, box, triangles, closed };
}

// ---------- face segmentation ----------
export function segmentFaces(pos: Float32Array, idx: Uint32Array, brepFaces: BrepFace[] | null) {
  const tc = idx.length / 3;
  const faceOf = new Int32Array(tc).fill(-1);
  const faces: { id: number; tris: number[] }[] = [];
  if (brepFaces && brepFaces.length) {
    brepFaces.forEach((f, i) => {
      const tris: number[] = [];
      for (let t = f.first; t <= f.last; t++) {
        tris.push(t);
        faceOf[t] = i;
      }
      faces.push({ id: i, tris });
    });
    return { faces, faceOf, source: "brep" as const };
  }
  if (tc > 1500000) return { faces, faceOf, source: "none" as const };

  // Weld coincident vertices so neighbours can be found across split vertices.
  const box = new THREE.Box3();
  for (let i = 0; i < pos.length; i += 3) box.expandByPoint(_a.set(pos[i], pos[i + 1], pos[i + 2]));
  const q = 1 / Math.max(box.getSize(_b).length() * 1e-6, 1e-9);
  const key2id = new Map<string, number>();
  const vid = new Uint32Array(pos.length / 3);
  let nid = 0;
  for (let v = 0; v < vid.length; v++) {
    const k = `${Math.round(pos[v * 3] * q)},${Math.round(pos[v * 3 + 1] * q)},${Math.round(pos[v * 3 + 2] * q)}`;
    let id = key2id.get(k);
    if (id === undefined) {
      id = nid++;
      key2id.set(k, id);
    }
    vid[v] = id;
  }
  const tn = new Float32Array(tc * 3);
  for (let t = 0; t < tc; t++) {
    triVerts(pos, idx, t);
    _n.crossVectors(_e1.subVectors(_b, _a), _e2.subVectors(_c, _a)).normalize();
    tn[t * 3] = _n.x;
    tn[t * 3 + 1] = _n.y;
    tn[t * 3 + 2] = _n.z;
  }
  const edgeMap = new Map<number, number>();
  const M = 4194304;
  const nb: number[][] = [];
  for (let t = 0; t < tc; t++) {
    for (let e = 0; e < 3; e++) {
      const a = vid[idx[t * 3 + e]], b = vid[idx[t * 3 + ((e + 1) % 3)]];
      if (a === b) continue;
      const k = a < b ? a * M + b : b * M + a;
      const o = edgeMap.get(k);
      if (o === undefined) edgeMap.set(k, t);
      else if (o >= 0) {
        (nb[t] ||= []).push(o);
        (nb[o] ||= []).push(t);
        edgeMap.set(k, -1);
      }
    }
  }
  const cosT = Math.cos(deg(12));
  const stack: number[] = [];
  for (let s = 0; s < tc; s++) {
    if (faceOf[s] !== -1) continue;
    const id = faces.length, tris: number[] = [];
    faceOf[s] = id;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop() as number;
      tris.push(t);
      const list = nb[t];
      if (!list) continue;
      for (const u of list) {
        if (faceOf[u] !== -1) continue;
        const d = tn[t * 3] * tn[u * 3] + tn[t * 3 + 1] * tn[u * 3 + 1] + tn[t * 3 + 2] * tn[u * 3 + 2];
        if (d >= cosT) {
          faceOf[u] = id;
          stack.push(u);
        }
      }
    }
    faces.push({ id, tris });
  }
  return { faces, faceOf, source: "mesh" as const };
}

// ---------- linear algebra ----------
function jacobiEigen(m: number[]): { values: number[]; vectors: THREE.Vector3[] } {
  const a = m.slice(), v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 30; sweep++) {
    if (Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]) < 1e-14) break;
    for (const [p, qq] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + qq];
      if (Math.abs(apq) < 1e-15) continue;
      const th = 0.5 * Math.atan2(2 * apq, a[qq * 3 + qq] - a[p * 3 + p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + qq];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + qq] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[qq * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[qq * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + qq];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + qq] = s * vkp + c * vkq;
      }
    }
  }
  return {
    values: [a[0], a[4], a[8]],
    vectors: [0, 1, 2].map((i) => new THREE.Vector3(v[i], v[3 + i], v[6 + i]).normalize()),
  };
}

export function basisFor(axis: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const u = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  return [u, v];
}

/** Kåsa algebraic circle fit: x² + y² + D x + E y + F = 0. */
export function circleFit(pts: [number, number][]): { cx: number; cy: number; r: number; rms: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const B = [-sxz, -syz, -sz];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-20) return null;
  const sol = [0, 1, 2].map((c) => det(A.map((row, r) => row.map((val, k) => (k === c ? B[r] : val)))) / d);
  const cx = -sol[0] / 2, cy = -sol[1] / 2;
  const r2 = cx * cx + cy * cy - sol[2];
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let ss = 0;
  for (const [x, y] of pts) {
    const e = Math.hypot(x - cx, y - cy) - r;
    ss += e * e;
  }
  return { cx, cy, r, rms: Math.sqrt(ss / n) };
}

function sweepOf(angles: number[]): number {
  if (angles.length < 2) return 0;
  angles.sort((x, y) => x - y);
  let gap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  return Math.PI * 2 - gap;
}

// ---------- face classification ----------
export function classifyFace(face: { id: number; tris: number[] }, pos: Float32Array, idx: Uint32Array, nor: Float32Array | null): Face {
  const tris = face.tris;
  let area = 0;
  const mean = new THREE.Vector3();
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const tn: THREE.Vector3[] = [], ta: number[] = [], tcen: THREE.Vector3[] = [];
  const vset = new Set<number>();
  for (const t of tris) {
    triVerts(pos, idx, t);
    _n.crossVectors(_e1.subVectors(_b, _a), _e2.subVectors(_c, _a));
    const a2 = _n.length();
    if (a2 < 1e-20) continue;
    _n.divideScalar(a2);
    if (nor) {
      // Supplied vertex normals are the most reliable orientation.
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 3; k++) {
        const i = idx[t * 3 + k] * 3;
        sx += nor[i]; sy += nor[i + 1]; sz += nor[i + 2];
      }
      if (_n.x * sx + _n.y * sy + _n.z * sz < 0) _n.negate();
    }
    const a = a2 / 2;
    area += a;
    mean.addScaledVector(_n, a);
    M[0] += a * _n.x * _n.x; M[1] += a * _n.x * _n.y; M[2] += a * _n.x * _n.z;
    M[4] += a * _n.y * _n.y; M[5] += a * _n.y * _n.z; M[8] += a * _n.z * _n.z;
    tn.push(_n.clone());
    ta.push(a);
    tcen.push(new THREE.Vector3().add(_a).add(_b).add(_c).divideScalar(3));
    for (let k = 0; k < 3; k++) vset.add(idx[t * 3 + k]);
  }
  M[3] = M[1]; M[6] = M[2]; M[7] = M[5];
  const base = { id: face.id, tris, area };
  if (!tn.length) return { ...base, type: "freeform" };
  const mlen = mean.length();
  mean.normalize();
  let minDot = 1;
  for (const n of tn) minDot = Math.min(minDot, n.dot(mean));
  if (mlen / area > 0.9999 || minDot > Math.cos(deg(1.5))) {
    return { ...base, type: "plane", normal: mean.clone(), offset: tcen[0].dot(mean) };
  }
  const eig = jacobiEigen(M);
  let k = 0;
  for (let i = 1; i < 3; i++) if (eig.values[i] < eig.values[k]) k = i;
  const axis = eig.vectors[k];
  let maxAx = 0;
  for (const n of tn) maxAx = Math.max(maxAx, Math.abs(n.dot(axis)));
  if (maxAx > 0.1 || vset.size < 6) return { ...base, type: "freeform" };
  const [u, v] = basisFor(axis);
  const pts: [number, number][] = [];
  let tMin = Infinity, tMax = -Infinity;
  for (const vi of vset) {
    _a.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
    pts.push([_a.dot(u), _a.dot(v)]);
    const t = _a.dot(axis);
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
  }
  const fit = circleFit(pts);
  if (!fit || fit.rms / fit.r > 0.01) return { ...base, type: "freeform" };
  const angles = pts.map(([x, y]) => Math.atan2(y - fit.cy, x - fit.cx));
  // Concave (hole-like) when normals point toward the axis.
  let side = 0;
  tn.forEach((n, i) => {
    const c = tcen[i];
    side += ta[i] * (n.dot(u) * (c.dot(u) - fit.cx) + n.dot(v) * (c.dot(v) - fit.cy));
  });
  return {
    ...base,
    type: "cylinder",
    axis: axis.clone(),
    u,
    v,
    cx: fit.cx,
    cy: fit.cy,
    radius: snapSig(fit.r),
    rms: fit.rms,
    tMin,
    tMax,
    sweep: sweepOf(angles.slice()),
    angles,
    concave: side < 0,
  };
}

// ---------- ray casting against a triangle soup ----------
function rayHit(pos: Float32Array, idx: Uint32Array, o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
  let best = Infinity;
  const tc = idx.length / 3;
  const p = new THREE.Vector3(), tv = new THREE.Vector3(), qv = new THREE.Vector3();
  for (let t = 0; t < tc; t++) {
    triVerts(pos, idx, t);
    _e1.subVectors(_b, _a);
    _e2.subVectors(_c, _a);
    p.crossVectors(d, _e2);
    const det = _e1.dot(p);
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    tv.subVectors(o, _a);
    const uu = tv.dot(p) * inv;
    if (uu < 0 || uu > 1) continue;
    qv.crossVectors(tv, _e1);
    const vv = d.dot(qv) * inv;
    if (vv < 0 || uu + vv > 1) continue;
    const dist = _e2.dot(qv) * inv;
    if (dist > 1e-9 && dist < best && dist < maxDist) best = dist;
  }
  return best;
}

// ---------- feature recognition ----------
interface CylGroup {
  axis: THREE.Vector3;
  center: THREE.Vector3;
  radius: number;
  concave: boolean;
  faces: number[];
  tMin: number;
  tMax: number;
  angles: number[];
  rms: number;
  area: number;
  sweep: number;
}

/** Canonical direction so parallel axes compare equal. */
export function axisKey(axis: THREE.Vector3): THREE.Vector3 {
  const a = axis.clone();
  const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
  const m: "x" | "y" | "z" = ax > ay ? (ax > az ? "x" : "z") : ay > az ? "y" : "z";
  if (a[m] < 0) a.negate();
  return a;
}

function lineDist(c: THREE.Vector3, axis: THREE.Vector3, p: THREE.Vector3): number {
  const d = p.clone().sub(c);
  return d.sub(axis.clone().multiplyScalar(d.dot(axis))).length();
}

function overlapsOrTouches(g: CylGroup, f: CylinderFace, ax: THREE.Vector3, diag: number): boolean {
  const sgn = Math.sign(f.axis.dot(ax)) || 1;
  const t0 = Math.min(f.tMin * sgn, f.tMax * sgn), t1 = Math.max(f.tMin * sgn, f.tMax * sgn);
  const tol = Math.max(diag * 1e-4, f.radius * 0.02);
  return t0 <= g.tMax + tol && t1 >= g.tMin - tol;
}

/** Merge coaxial cylinders of equal radius (STEP often splits a hole into two half faces). */
function groupCylinders(cyls: CylinderFace[], diag: number): CylGroup[] {
  const groups: CylGroup[] = [];
  for (const f of cyls) {
    const ax = axisKey(f.axis);
    const c3 = f.u.clone().multiplyScalar(f.cx).add(f.v.clone().multiplyScalar(f.cy));
    let g = groups.find(
      (g) =>
        g.concave === f.concave &&
        Math.abs(g.axis.dot(ax)) > 0.9995 &&
        Math.abs(g.radius - f.radius) < Math.max(f.radius * 0.005, diag * 1e-6) &&
        lineDist(g.center, g.axis, c3) < Math.max(f.radius * 0.03, diag * 1e-5) &&
        overlapsOrTouches(g, f, ax, diag),
    );
    if (!g) {
      g = { axis: ax, center: c3, radius: f.radius, concave: f.concave, faces: [], tMin: Infinity, tMax: -Infinity, angles: [], rms: 0, area: 0, sweep: 0 };
      groups.push(g);
    }
    const sgn = Math.sign(f.axis.dot(ax)) || 1;
    const t0 = f.tMin * sgn, t1 = f.tMax * sgn;
    g.tMin = Math.min(g.tMin, t0, t1);
    g.tMax = Math.max(g.tMax, t0, t1);
    const [gu, gv] = basisFor(g.axis);
    const gcx = g.center.dot(gu), gcy = g.center.dot(gv);
    for (const ang of f.angles) {
      const p = c3.clone().add(f.u.clone().multiplyScalar(Math.cos(ang) * f.radius)).add(f.v.clone().multiplyScalar(Math.sin(ang) * f.radius));
      g.angles.push(Math.atan2(p.dot(gv) - gcy, p.dot(gu) - gcx));
    }
    g.faces.push(f.id);
    g.rms = Math.max(g.rms, f.rms);
    g.area += f.area;
  }
  groups.forEach((g) => {
    g.sweep = sweepOf(g.angles.slice());
    g.angles = [];
  });
  return groups;
}

const fitPct = (rel: number) => (rel < 1e-5 ? "under 0.001%" : `${(rel * 100).toFixed(rel < 0.001 ? 3 : 2)}%`);
const facesWord = (n: number, src: string) => `${n} ${src === "brep" ? "B-rep" : "mesh"} face${n === 1 ? "" : "s"}`;

export function recognizeFeatures(
  part: { pos: Float32Array; idx: Uint32Array; faces: Face[]; diag: number; faceSource: string },
  counters: FeatureCounters,
): Feature[] {
  const { pos, idx, faces, diag, faceSource } = part;
  const cyls = faces.filter((f): f is CylinderFace => f.type === "cylinder");
  const groups = groupCylinders(cyls, diag);
  const features: Feature[] = [];
  const tol = Math.max(diag * 2e-4, 1e-6);

  // Holes: full-sweep concave cylinders, stacked when coaxial and touching.
  const holeSegs = groups.filter((g) => g.concave && g.sweep > deg(300));
  const used = new Set<CylGroup>();
  const stacks: CylGroup[][] = [];
  for (const s of holeSegs) {
    if (used.has(s)) continue;
    const stack = [s];
    used.add(s);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of holeSegs) {
        if (used.has(o)) continue;
        if (Math.abs(o.axis.dot(s.axis)) < 0.9995 || lineDist(s.center, s.axis, o.center) > Math.max(s.radius, o.radius) * 0.05) continue;
        if (stack.some((m) => Math.abs(m.tMax - o.tMin) < tol || Math.abs(o.tMax - m.tMin) < tol)) {
          stack.push(o);
          used.add(o);
          grew = true;
        }
      }
    }
    stack.sort((a, b) => a.tMin - b.tMin);
    stacks.push(stack);
  }

  for (const stack of stacks) {
    const axis = stack[0].axis.clone();
    const c = stack[0].center;
    const tMin = stack[0].tMin, tMax = stack[stack.length - 1].tMax;
    const minSeg = stack.reduce((m, s) => (s.radius < m.radius ? s : m), stack[0]);
    const mid = (minSeg.tMin + minSeg.tMax) / 2;
    const midPt = c.clone().add(axis.clone().multiplyScalar(mid));
    const reach = (tMax - tMin) * 4 + diag * 0.01;
    // Thru when nothing blocks the axis beyond either end of the hole.
    const openUp = rayHit(pos, idx, midPt, axis, reach) > tMax - mid + tol * 4;
    const openDn = rayHit(pos, idx, midPt, axis.clone().negate(), reach) > mid - tMin + tol * 4;
    const thru = openUp && openDn;

    let type: HoleFeature["type"] = "Hole";
    let cbore: HoleFeature["cbore"] = null;
    let entryAtMax = openUp;
    let small = minSeg;
    if (stack.length === 2) {
      const [lo, hi] = stack;
      const bigAtMin = lo.radius > hi.radius;
      const big = bigAtMin ? lo : hi;
      small = bigAtMin ? hi : lo;
      type = "Counterbore";
      cbore = { radius: big.radius, depth: snapSig(big.tMax - big.tMin) };
      entryAtMax = !bigAtMin;
    } else if (stack.length > 2) type = "Stepped hole";

    const entry = c.clone().add(axis.clone().multiplyScalar(entryAtMax ? tMax : tMin));
    const inward = entryAtMax ? axis.clone().negate() : axis.clone();
    const length = snapSig(tMax - tMin);
    const rmsRel = Math.max(...stack.map((s) => s.rms / s.radius));
    const faceIds = stack.flatMap((s) => s.faces);
    features.push({
      kind: "hole",
      type,
      name: `Hole${pad(++counters.hole)}`,
      faceIds,
      source: "cad_import",
      evidence: `${facesWord(faceIds.length, faceSource)}; cylinder fit RMS ${fitPct(rmsRel)} of radius; ${thru ? "axis clear at both ends" : "axis blocked at one end"}`,
      radius: small.radius,
      cbore,
      thru,
      depth: thru ? null : length,
      length,
      axis: inward,
      entry,
      volumeRemoved: stack.reduce((v, s) => v + Math.PI * s.radius * s.radius * (s.tMax - s.tMin), 0),
      confidence: Math.max(60, Math.min(99, Math.round(99.4 - rmsRel * 2500 - (stack.length > 2 ? 4 : 0)))),
      segments: stack.length,
    });
  }

  // Fillets and rounds: partial cylinders, grouped per radius and side.
  const byR = new Map<string, CylGroup[]>();
  for (const g of groups.filter((g) => g.sweep < deg(200))) {
    const k = `${g.concave ? "c" : "v"}${g.radius.toFixed(5)}`;
    const list = byR.get(k);
    if (list) list.push(g);
    else byR.set(k, [g]);
  }
  for (const list of byR.values()) {
    const g0 = list[0];
    const rmsRel = Math.max(...list.map((g) => g.rms / g.radius));
    const faceIds = list.flatMap((g) => g.faces);
    const fillet: FilletFeature = {
      kind: "fillet",
      type: g0.concave ? "Fillet" : "Round",
      name: `Fillet${pad(++counters.fillet)}`,
      faceIds,
      source: "cad_import",
      evidence: `${facesWord(faceIds.length, faceSource)}; partial-cylinder fit RMS ${fitPct(rmsRel)} of radius`,
      radius: g0.radius,
      edges: list.length,
      confidence: Math.max(60, Math.min(99, Math.round(98.5 - rmsRel * 2500))),
    };
    features.push(fillet);
  }

  // Bosses: full convex cylinders.
  for (const g of groups.filter((g) => !g.concave && g.sweep > deg(300))) {
    const rel = g.rms / g.radius;
    const boss: BossFeature = {
      kind: "boss",
      type: "Boss",
      name: `Boss${pad(++counters.boss)}`,
      faceIds: g.faces,
      source: "cad_import",
      evidence: `${facesWord(g.faces.length, faceSource)}; cylinder fit RMS ${fitPct(rel)} of radius`,
      radius: g.radius,
      length: snapSig(g.tMax - g.tMin),
      axis: g.axis.clone(),
      entry: g.center.clone().add(g.axis.clone().multiplyScalar(g.tMax)),
      confidence: Math.max(60, Math.min(99, Math.round(99 - rel * 2500))),
    };
    features.push(boss);
  }

  // Patterns of identical holes.
  const holes = features.filter((f): f is HoleFeature => f.kind === "hole");
  const sig = (h: HoleFeature) =>
    [
      h.type,
      (2 * h.radius).toFixed(4),
      h.cbore ? `${(2 * h.cbore.radius).toFixed(4)}x${h.cbore.depth.toFixed(4)}` : "",
      h.thru ? "T" : (h.depth ?? 0).toFixed(4),
      axisKey(h.axis).toArray().map((x) => x.toFixed(3)).join(","),
    ].join("|");
  const bySig = new Map<string, HoleFeature[]>();
  holes.forEach((h) => {
    const s = sig(h);
    const list = bySig.get(s);
    if (list) list.push(h);
    else bySig.set(s, [h]);
  });
  for (const members of bySig.values()) {
    if (members.length < 2) continue;
    const p: PatternFeature = {
      kind: "pattern",
      type: "Pattern",
      name: `Pattern${pad(++counters.pattern)}`,
      members: members.map((m) => m.name),
      count: members.length,
      arrangement: arrangement(members.map((m) => m.entry), members[0].axis),
      faceIds: members.flatMap((m) => m.faceIds),
      source: "cad_import",
      evidence: `${members.length} holes with identical size, depth and axis direction`,
    };
    members.forEach((m) => {
      m.pattern = p.name;
      m.patternCount = members.length;
    });
    features.push(p);
  }
  return features;
}

export function arrangement(points: THREE.Vector3[], axis: THREE.Vector3): PatternFeature["arrangement"] {
  if (points.length === 2) return "Linear";
  const c = points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length);
  const [u, v] = basisFor(axis.clone().normalize());
  const p2 = points.map((p) => [p.clone().sub(c).dot(u), p.clone().sub(c).dot(v)] as const);
  let sxx = 0, syy = 0, sxy = 0;
  p2.forEach(([x, y]) => { sxx += x * x; syy += y * y; sxy += x * y; });
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  if (tr > 0 && l2 / tr < 1e-4) return "Linear";
  const ds = p2.map(([x, y]) => Math.hypot(x, y));
  const dm = ds.reduce((a, b) => a + b, 0) / ds.length;
  const circular = ds.every((d) => Math.abs(d - dm) < dm * 0.01);
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tolR = dm * 0.01 + 1e-9;
  const uniq = (arr: number[]) => arr.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > tolR).length;
  const grid = (c0: number, s0: number) => {
    const nu = uniq(p2.map(([x, y]) => x * c0 + y * s0));
    const nv = uniq(p2.map(([x, y]) => -x * s0 + y * c0));
    return nu * nv === points.length && nu > 1 && nv > 1;
  };
  if (grid(Math.cos(ang), Math.sin(ang)) || grid(1, 0)) return "Rectangular";
  if (circular) return "Circular";
  return "Scattered";
}

/** Full analysis for one body. */
export function analyzePart(mesh: MeshData, counters: FeatureCounters): PartAnalysis {
  const { position: pos, index: idx, normal: nor } = mesh;
  const mp = massProps(pos, idx);
  const diag = mp.box.getSize(new THREE.Vector3()).length();
  const seg = segmentFaces(pos, idx, mesh.brepFaces);
  const faces = seg.faces.map((f) => classifyFace(f, pos, idx, nor));
  let features: Feature[] = [];
  try {
    features = recognizeFeatures({ pos, idx, faces, diag, faceSource: seg.source }, counters);
  } catch (e) {
    console.warn("Feature recognition failed", e);
  }
  return { ...mp, diag, faces, faceOf: seg.faceOf, faceSource: seg.source, features };
}

export function newCounters(): FeatureCounters {
  return { hole: 0, fillet: 0, boss: 0, pattern: 0 };
}
