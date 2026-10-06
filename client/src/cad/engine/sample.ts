// Procedural sample: a machined bracket assembly built as watertight solids with
// B-rep-style face groups, so feature recognition behaves as it does on a STEP import.
// Ported from c-engineering-workbench js/sample.js. Units: inches, Z up.
import * as THREE from "three";
import type { BrepFace, MeshData, ModelData } from "./types";

const SEG = 48;

class Loop {
  edges: THREE.Vector2[][] = [];
  private cur = new THREE.Vector2();

  moveTo(x: number, y: number): this {
    this.cur = new THREE.Vector2(x, y);
    return this;
  }
  lineTo(x: number, y: number): this {
    const p = new THREE.Vector2(x, y);
    this.edges.push([this.cur.clone(), p]);
    this.cur = p;
    return this;
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, seg = SEG): this {
    const n = Math.max(2, Math.ceil((seg * Math.abs(a1 - a0)) / (Math.PI * 2)));
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    this.edges.push(pts);
    this.cur = pts[pts.length - 1].clone();
    return this;
  }
  points(): THREE.Vector2[] {
    const out: THREE.Vector2[] = [];
    for (const e of this.edges) for (let i = 0; i < e.length - 1; i++) out.push(e[i]);
    return out;
  }
  static circle(cx: number, cy: number, r: number, cw = false): Loop {
    return new Loop().arc(cx, cy, r, 0, cw ? -Math.PI * 2 : Math.PI * 2);
  }
}

interface HoleSpec {
  x: number;
  y: number;
  r: number;
  cbR?: number;
  cbD?: number;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  faces: BrepFace[] = [];
  private start = 0;

  private begin(): void {
    this.start = this.idx.length / 3;
  }
  private end(): void {
    const last = this.idx.length / 3 - 1;
    if (last >= this.start) this.faces.push({ first: this.start, last });
  }
  private v(p: THREE.Vector3, n: THREE.Vector3): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    return this.pos.length / 3 - 1;
  }

  /** Planar cap at height z facing up (+1) or down (-1). Outer loop CCW, holes CW. */
  cap(outer: Loop, holes: Loop[], z: number, dir: 1 | -1): void {
    const contour = outer.points();
    const hs = holes.map((h) => h.points());
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = contour.concat(...hs);
    const n = new THREE.Vector3(0, 0, dir);
    this.begin();
    const base = all.map((p) => this.v(new THREE.Vector3(p.x, p.y, z), n));
    for (const [a, b, c] of tris) {
      const A = all[a], B = all[b], C = all[c];
      const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
      if (area > 0 === dir > 0) this.idx.push(base[a], base[b], base[c]);
      else this.idx.push(base[a], base[c], base[b]);
    }
    this.end();
  }

  /** One wall face per loop edge between z0 and z1, normals pointing away from material. */
  walls(loop: Loop, z0: number, z1: number): void {
    for (const e of loop.edges) {
      const segN: THREE.Vector3[] = [];
      for (let i = 0; i < e.length - 1; i++) {
        const d = e[i + 1].clone().sub(e[i]).normalize();
        segN.push(new THREE.Vector3(d.y, -d.x, 0));
      }
      const vN = e.map((_, j) => segN[Math.max(0, j - 1)].clone().add(segN[Math.min(segN.length - 1, j)]).normalize());
      this.begin();
      for (let i = 0; i < e.length - 1; i++) {
        const p0 = e[i], p1 = e[i + 1];
        const a = this.v(new THREE.Vector3(p0.x, p0.y, z0), vN[i]);
        const b = this.v(new THREE.Vector3(p1.x, p1.y, z0), vN[i + 1]);
        const c = this.v(new THREE.Vector3(p1.x, p1.y, z1), vN[i + 1]);
        const d = this.v(new THREE.Vector3(p0.x, p0.y, z1), vN[i]);
        this.idx.push(a, b, c, a, c, d);
      }
      this.end();
    }
  }

  /** Plate of thickness t with holes; holes may carry a counterbore opening at the top. */
  steppedPlate(outerFn: () => Loop, holes: HoleSpec[], t: number): void {
    const cbHoles = holes.filter((h) => h.cbR);
    const cbD = cbHoles.length ? Math.max(...cbHoles.map((h) => h.cbD ?? 0)) : 0;
    const zStep = t - cbD;
    const small = holes.map((h) => Loop.circle(h.x, h.y, h.r, true));
    const big = holes.map((h) => Loop.circle(h.x, h.y, h.cbR ?? h.r, true));
    this.cap(outerFn(), small, 0, -1);
    this.walls(outerFn(), 0, t);
    holes.forEach((h, i) => this.walls(small[i], 0, h.cbR ? zStep : t));
    holes.forEach((h, i) => {
      if (!h.cbR) return;
      this.cap(Loop.circle(h.x, h.y, h.cbR), [small[i]], zStep, 1);
      this.walls(big[i], zStep, t);
    });
    this.cap(outerFn(), big, t, 1);
  }

  /** Surface of revolution around Z. Profile [r, z] pairs start and end on the axis. */
  lathe(profile: [number, number][], seg = SEG): void {
    for (let k = 0; k < profile.length - 1; k++) {
      const [r0, z0] = profile[k], [r1, z1] = profile[k + 1];
      const L = Math.hypot(r1 - r0, z1 - z0);
      const nr = (z1 - z0) / L, nz = -(r1 - r0) / L;
      const N = (t: number) => new THREE.Vector3(nr * Math.cos(t), nr * Math.sin(t), nz);
      const P = (r: number, z: number, t: number) => new THREE.Vector3(r * Math.cos(t), r * Math.sin(t), z);
      this.begin();
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        const a = this.v(P(r0, z0, t0), N(t0)), b = this.v(P(r0, z0, t1), N(t1));
        const c = this.v(P(r1, z1, t1), N(t1)), d = this.v(P(r1, z1, t0), N(t0));
        if (r0 > 1e-9) this.idx.push(a, b, c);
        if (r1 > 1e-9) this.idx.push(a, c, d);
      }
      this.end();
    }
  }

  toMesh(name: string, color: number[], matrix?: THREE.Matrix4): MeshData {
    const position = new Float32Array(this.pos), normal = new Float32Array(this.nor);
    if (matrix) {
      const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrix);
      for (let i = 0; i < position.length; i += 3) {
        v.fromArray(position, i).applyMatrix4(matrix).toArray(position, i);
        v.fromArray(normal, i).applyMatrix3(nm).normalize().toArray(normal, i);
      }
    }
    return { name, color, position, normal, index: new Uint32Array(this.idx), brepFaces: this.faces };
  }
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Loop {
  return new Loop()
    .moveTo(x0 + r, y0).lineTo(x1 - r, y0)
    .arc(x1 - r, y0 + r, r, -Math.PI / 2, 0, 24)
    .lineTo(x1, y1 - r)
    .arc(x1 - r, y1 - r, r, 0, Math.PI / 2, 24)
    .lineTo(x0 + r, y1)
    .arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, 24)
    .lineTo(x0, y0 + r)
    .arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, 24);
}

export function buildSampleBracket(): ModelData {
  const meshes: MeshData[] = [];
  const TI = [0.74, 0.74, 0.76];

  // Upright: 0.375 thick, 2.500 tall, main mounting hole (counterbored) and a lightening hole.
  const up = new Builder();
  up.steppedPlate(
    () => new Loop().moveTo(-1.25, 0.375).lineTo(1.25, 0.375).lineTo(0.4, 2.1).arc(0, 2.1, 0.4, 0, Math.PI).lineTo(-1.25, 0.375),
    [
      { x: 0, y: 2.1, r: 0.1875, cbR: 0.3125, cbD: 0.125 },
      { x: 0, y: 1.15, r: 0.375 },
    ],
    0.375,
  );
  // local (x, y, z) -> world (x, -z + 0.1875, y)
  const upM = new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0))
    .setPosition(0, 0.1875, 0);
  meshes.push(up.toMesh("Upright (Part001)", TI, upM));

  // Base plate: 3.750 x 2.000 x 0.375 with 4x Ø0.375 holes, counterbored Ø0.625 x 0.125.
  const plateHoles: HoleSpec[] = [[-1.4, -0.55], [1.4, -0.55], [1.4, 0.55], [-1.4, 0.55]].map(([x, y]) => ({ x, y, r: 0.1875, cbR: 0.3125, cbD: 0.125 }));
  const plate = new Builder();
  plate.steppedPlate(() => roundedRect(-1.875, -1, 1.875, 1, 0.25), plateHoles, 0.375);
  meshes.push(plate.toMesh("Base Plate (Part002)", TI));

  // Gussets: triangular ribs behind the upright.
  const gusset = (x: number, name: string) => {
    const g = new Builder();
    const outer = () => new Loop().moveTo(0.1875, 0.375).lineTo(0.95, 0.375).lineTo(0.95, 0.5).lineTo(0.1875, 1.75).lineTo(0.1875, 0.375);
    g.cap(outer(), [], 0, -1);
    g.walls(outer(), 0, 0.25);
    g.cap(outer(), [], 0.25, 1);
    const m = new THREE.Matrix4()
      .makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
      .setPosition(x - 0.125, 0, 0);
    meshes.push(g.toMesh(name, TI, m));
  };
  gusset(-0.9, "Left Gusset (Part003)");
  gusset(0.9, "Right Gusset (Part004)");

  // Socket head cap screws in the base pattern.
  const screwIdx: number[] = [];
  plateHoles.forEach((h, i) => {
    const s = new Builder();
    s.lathe([[0, -0.25], [0.18, -0.25], [0.18, 0.25], [0.28, 0.25], [0.28, 0.5], [0, 0.5]]);
    const mesh = s.toMesh(`SHCS 3/8-16 x 0.75 (${i + 1})`, [0.22, 0.23, 0.25], new THREE.Matrix4().makeTranslation(h.x, h.y, 0));
    mesh.keepColor = true;
    screwIdx.push(meshes.length);
    meshes.push(mesh);
  });

  return {
    name: "Sample bracket assembly",
    fileName: "Built-in sample",
    mmPerUnit: 25.4,
    format: "Sample",
    sample: true,
    root: {
      name: "Sample bracket assembly",
      meshes: [],
      children: [
        { name: "Upright (Part001)", meshes: [0], children: [] },
        { name: "Base Plate (Part002)", meshes: [1], children: [] },
        { name: "Left Gusset (Part003)", meshes: [2], children: [] },
        { name: "Right Gusset (Part004)", meshes: [3], children: [] },
        { name: "Fasteners", meshes: [], children: screwIdx.map((i) => ({ name: meshes[i].name, meshes: [i], children: [] })) },
      ],
    },
    meshes,
  };
}
