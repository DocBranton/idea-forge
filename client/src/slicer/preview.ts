// three.js view of the build plate: the part before slicing, then its toolpaths colored
// by feature, cut off at the chosen layer and move. Renders only when something changes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { MeshData } from "../cad/engine/types";
import { FEATURES, type FeatureKind, type ParsedGcode } from "./gcode";
import type { Printer } from "./profiles";

const BG = 0x07101c;
const PLATE = 0x10243c;
const GRID = 0x1d3a58;
const EDGE = 0x5ac8ff;

export class SlicePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
  private controls: OrbitControls;
  private plate = new THREE.Group();
  private part = new THREE.Group();
  private paths: THREE.LineSegments | null = null;
  private gcode: ParsedGcode | null = null;
  /** Visible segments up to and including each layer, for the draw range. */
  private visibleThrough: Uint32Array = new Uint32Array(0);
  private visibleBefore: Uint32Array = new Uint32Array(0);
  private hidden = new Set<FeatureKind>();
  private top = 0;
  private moves = 1;
  private frame = 0;
  private resize: ResizeObserver;
  private bed = { w: 200, d: 200, h: 200 };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(BG);
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener("change", () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x0a1628, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, -2, 3);
    this.scene.add(sun, this.plate, this.part);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
  }

  setPrinter(p: Printer): void {
    this.bed = p.bed;
    this.plate.clear();
    const { w, d } = p.bed;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: PLATE }));
    plate.position.set(w / 2, d / 2, -0.05);
    const pts: number[] = [];
    for (let x = 0; x <= w + 1e-6; x += 10) pts.push(x, 0, 0, x, d, 0);
    for (let y = 0; y <= d + 1e-6; y += 10) pts.push(0, y, 0, w, y, 0);
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: GRID }),
    );
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, 0, 0), new THREE.Vector3(w, d, 0), new THREE.Vector3(0, d, 0)]),
      new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.6 }),
    );
    this.plate.add(plate, grid, edge);
    this.home();
  }

  /** Show the part as a solid, centred on the bed and resting on it. Millimetres. */
  setPart(meshes: readonly MeshData[], mmPerUnit: number, visible: boolean): void {
    this.part.clear();
    const box = new THREE.Box3();
    const group = new THREE.Group();
    for (const m of meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.1, roughness: 0.65 }));
      group.add(mesh);
    }
    group.scale.setScalar(mmPerUnit);
    group.updateMatrixWorld(true);
    box.setFromObject(group);
    const c = box.getCenter(new THREE.Vector3());
    group.position.set(this.bed.w / 2 - c.x, this.bed.d / 2 - c.y, -box.min.z);
    this.part.add(group);
    this.part.visible = visible;
    this.render();
  }

  showPart(visible: boolean): void {
    this.part.visible = visible;
    this.render();
  }

  setGcode(g: ParsedGcode | null): void {
    this.gcode = g;
    this.top = g ? g.layers.length - 1 : 0;
    this.moves = 1;
    this.build();
  }

  setHidden(kinds: Set<FeatureKind>): void {
    this.hidden = new Set(kinds);
    this.build();
  }

  /** Show layers 0..top; `moves` (0–1) is how much of the top layer is drawn. */
  setRange(top: number, moves = 1): void {
    this.top = top;
    this.moves = moves;
    this.applyRange();
  }

  home(): void {
    const { w, d, h } = this.bed;
    const r = Math.max(w, d, h * 0.8);
    this.controls.target.set(w / 2, d / 2, Math.min(h, 60) / 3);
    this.camera.position.set(w / 2 - r * 0.55, d / 2 - r * 1.15, r * 0.95);
    this.camera.near = r / 100;
    this.camera.far = r * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const any = o as THREE.Mesh;
      any.geometry?.dispose?.();
      const mat = any.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => m.dispose());
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private build(): void {
    if (this.paths) {
      this.scene.remove(this.paths);
      this.paths.geometry.dispose();
      (this.paths.material as THREE.Material).dispose();
      this.paths = null;
    }
    const g = this.gcode;
    if (!g || g.layers.length === 0) {
      this.render();
      return;
    }
    const colors = FEATURES.map((f) => new THREE.Color(f.color));
    const hiddenIdx = new Set(FEATURES.flatMap((f, i) => (this.hidden.has(f.kind) ? [i] : [])));
    // Layers are in file order, which is bottom to top for both slicers.
    let count = 0;
    for (let s = 0; s < g.kinds.length; s++) if (!hiddenIdx.has(g.kinds[s])) count++;
    const pos = new Float32Array(count * 6);
    const col = new Float32Array(count * 6);
    this.visibleThrough = new Uint32Array(g.layers.length);
    this.visibleBefore = new Uint32Array(g.layers.length);
    let n = 0;
    g.layers.forEach((layer, li) => {
      this.visibleBefore[li] = n;
      for (let s = layer.start; s < layer.end; s++) {
        const k = g.kinds[s];
        if (hiddenIdx.has(k)) continue;
        pos.set(g.segs.subarray(s * 6, s * 6 + 6), n * 6);
        const c = colors[k];
        col[n * 6] = col[n * 6 + 3] = c.r;
        col[n * 6 + 1] = col[n * 6 + 4] = c.g;
        col[n * 6 + 2] = col[n * 6 + 5] = c.b;
        n++;
      }
      this.visibleThrough[li] = n;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.paths = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.paths.frustumCulled = false;
    this.scene.add(this.paths);
    this.applyRange();
  }

  private applyRange(): void {
    const g = this.gcode;
    if (this.paths && g && g.layers.length) {
      const top = Math.max(0, Math.min(this.top, g.layers.length - 1));
      const before = this.visibleBefore[top];
      const through = this.visibleThrough[top];
      const end = before + Math.round((through - before) * Math.max(0, Math.min(1, this.moves)));
      this.paths.geometry.setDrawRange(0, end * 2);
    }
    this.render();
  }

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.renderer.render(this.scene, this.camera));
  }
}
