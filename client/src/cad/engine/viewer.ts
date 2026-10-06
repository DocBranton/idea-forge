// Imperative three.js viewer: rendering, navigation tools, picking, section, explode,
// measure, annotations, view cube and axis triad. Ported from c-engineering-workbench
// js/viewer.js; React wraps it in CadWorkspace and listens to its events.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Face, Feature, HoleFeature, MeshData, ModelData, PartAnalysis } from "./types";
import type { Units } from "./units";

export type Tool = "select" | "pan" | "rotate" | "zoom" | "measure";
export type PickMode = "part" | "feature" | "face";
export type DisplayMode = "shaded-edges" | "shaded" | "wireframe" | "xray";
export type Look = "titanium" | "aluminum" | "steel" | "original";
export type ViewName = "iso" | "front" | "back" | "top" | "bottom" | "left" | "right";
export type Axis = "x" | "y" | "z";

export type Selection =
  | { kind: "part"; part: number }
  | { kind: "face"; part: number; faceId: number }
  | { kind: "feature"; part: number; feature: string }
  | { kind: "assembly"; parts: number[]; key: string; name: string };

export interface SectionState {
  enabled: boolean;
  axis: Axis;
  t: number;
  flip: boolean;
}

export interface Hit {
  part: number;
  faceIndex: number;
  faceId: number;
  point: THREE.Vector3;
}

export interface MeasurePoint extends Hit {
  face?: Face;
}

export interface MeasureResult {
  distance: number;
  delta: THREE.Vector3;
  planeGap?: number;
}

export interface ViewerPart {
  index: number;
  name: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  src: MeshData;
  fileColor: THREE.Color | null;
  keepColor: boolean;
  visible: boolean;
  data: PartAnalysis | null;
  center: THREE.Vector3;
  explodeDir: THREE.Vector3;
  edges?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface LabelItem {
  el: HTMLDivElement;
  point: THREE.Vector3;
  leader?: { x: number; y: number };
}

const LOOKS: Record<Exclude<Look, "original">, { color: number; metalness: number; roughness: number }> = {
  titanium: { color: 0xa4a8ae, metalness: 0.92, roughness: 0.27 },
  aluminum: { color: 0xd3d6da, metalness: 0.85, roughness: 0.38 },
  steel: { color: 0x7a7f86, metalness: 0.9, roughness: 0.42 },
};
const GLOW = 0x3ee0ff;
const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(0.95, -1.35, 0.9),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  top: new THREE.Vector3(0, 0, 1),
  bottom: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};
const noRaycast = () => {};

function disposeObject(o: THREE.Object3D): void {
  o.parent?.remove(o);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

export interface ViewerOptions {
  host: HTMLElement;
  labels: HTMLElement;
  units: Units;
  viewcube?: HTMLElement | null;
  triad?: SVGSVGElement | null;
}

export class Viewer extends EventTarget {
  parts: ViewerPart[] = [];
  model: ModelData | null = null;
  tool: Tool = "select";
  pick: PickMode = "part";
  displayMode: DisplayMode = "shaded-edges";
  look: Look = "titanium";
  explode = 0;
  annotations = true;
  section: SectionState = { enabled: false, axis: "z", t: 0.5, flip: false };
  sectionValue = 0;
  selection: Selection | null = null;
  hovered: number | null = null;
  isolated: boolean[] | null = null;
  measurePts: MeasurePoint[] = [];
  fitToSelection = false;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly controls: OrbitControls;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private persp = new THREE.PerspectiveCamera(32, 1, 0.01, 1e6);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
  private host: HTMLElement;
  private labelsEl: HTMLElement;
  private triadEl: SVGSVGElement | null;
  private units: Units;
  private modelGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private raycaster = new THREE.Raycaster();
  private labelItems: LabelItem[] = [];
  private measureLabels: LabelItem[] = [];
  private overlayObjs: THREE.Object3D[] = [];
  private annoObjs: THREE.Object3D[] = [];
  private measureObjs: THREE.Object3D[] = [];
  private leaderSvg: SVGSVGElement;
  private dirty = true;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private tween: null | { t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; fromU: THREE.Vector3; toU: THREE.Vector3 } = null;
  private cube: null | { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.OrthographicCamera; mesh: THREE.Mesh } = null;
  private reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private unbind: (() => void)[] = [];

  constructor({ host, labels, units, viewcube, triad }: ViewerOptions) {
    super();
    this.host = host;
    this.labelsEl = labels;
    this.units = units;
    this.triadEl = triad ?? null;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.98;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.className = "cad-canvas";
    host.appendChild(r.domElement);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.9;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, -4, 6);
    const rim = new THREE.DirectionalLight(0x9fdcff, 0.8);
    rim.position.set(-5, 6, 2);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xdfeeff, 0x07101c, 0.35));

    [this.persp, this.ortho].forEach((c) => c.up.set(0, 0, 1));
    this.camera = this.persp;
    this.camera.position.copy(VIEW_DIRS.iso).multiplyScalar(10);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => {
      this.dirty = true;
    });

    this.scene.add(this.modelGroup, this.overlayGroup);
    this.shadow = this.makeShadow();
    this.scene.add(this.shadow);

    this.leaderSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.leaderSvg.setAttribute("class", "cad-leaders");
    this.labelsEl.appendChild(this.leaderSvg);

    if (viewcube) this.initViewCube(viewcube);
    this.bindPointer();
    this.setTool("select");
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.tween) this.stepTween();
      if (this.controls.update()) this.dirty = true;
      if (this.dirty) {
        this.render();
        this.dirty = false;
      }
    };
    loop();
  }

  /** Release GPU resources, listeners and DOM. Call on unmount. */
  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unbind.forEach((f) => f());
    this.clear();
    this.controls.dispose();
    disposeObject(this.shadow);
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.leaderSvg.remove();
    if (this.cube) {
      this.cube.renderer.dispose();
      this.cube.renderer.domElement.remove();
      disposeObject(this.cube.mesh);
    }
  }

  private emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  requestRender(): void {
    this.dirty = true;
  }

  resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.dirty = true;
  }

  private updateOrthoFrustum(): void {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    const d = this.persp.position.distanceTo(this.controls.target);
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    this.ortho.left = (-halfH * w) / h;
    this.ortho.right = (halfH * w) / h;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
  }

  setOrthographic(on: boolean): void {
    const from = this.camera, to = on ? this.ortho : this.persp;
    if (from === to) return;
    if (on) {
      this.persp.position.copy(from.position);
      this.updateOrthoFrustum();
      this.ortho.zoom = 1;
    }
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    if (!on) {
      const dir = from.position.clone().sub(this.controls.target);
      to.position.copy(this.controls.target).add(dir.multiplyScalar(1 / (this.ortho.zoom || 1)));
    }
    to.updateProjectionMatrix();
    this.camera = to;
    this.controls.object = to;
    this.controls.update();
    this.dirty = true;
  }

  private render(): void {
    this.renderer.clippingPlanes = this.section.enabled ? [this.clipPlane] : [];
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.renderViewCube();
    this.drawTriad();
  }

  /** PNG of the current view. */
  screenshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  // ---------- model ----------
  clear(): void {
    this.selection = null;
    this.hovered = null;
    this.isolated = null;
    this.clearOverlays();
    this.clearMeasure(true);
    for (const p of this.parts) disposeObject(p.mesh);
    this.modelGroup.clear();
    this.parts = [];
    this.setLabels([]);
    this.dirty = true;
  }

  setModel(model: ModelData): void {
    this.clear();
    this.model = model;
    model.meshes.forEach((m, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
      if (m.normal) g.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      if (!m.normal) g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.userData.partIndex = i;
      mesh.name = m.name;
      this.modelGroup.add(mesh);
      this.parts.push({
        index: i,
        name: m.name,
        mesh,
        src: m,
        fileColor: m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : null,
        keepColor: !!m.keepColor,
        visible: true,
        data: null,
        center: (g.boundingBox as THREE.Box3).getCenter(new THREE.Vector3()),
        explodeDir: new THREE.Vector3(),
      });
    });
    this.computeExplodeVectors();
    this.applyLook();
    this.applyDisplayMode();
    this.setExplode(0);
    this.fit(false, "iso");
    this.updateShadow();
  }

  private computeExplodeVectors(): void {
    const box = this.modelBox(true);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    for (const p of this.parts) {
      const d = p.center.clone().sub(c);
      if (d.length() < size * 0.02) d.set(0, 0, 0.0001);
      p.explodeDir = d.multiplyScalar(1.1);
    }
  }

  private partBox(p: ViewerPart): THREE.Box3 {
    return (p.mesh.geometry.boundingBox as THREE.Box3).clone().translate(p.mesh.position);
  }

  modelBox(all = false): THREE.Box3 {
    const box = new THREE.Box3();
    for (const p of this.parts) if (all || p.visible) box.union(this.partBox(p));
    return box;
  }

  setLook(look: Look): void {
    this.look = look;
    this.applyLook();
  }

  private applyLook(): void {
    for (const p of this.parts) {
      const m = p.mesh.material;
      if (p.keepColor) {
        m.color.set(0x3a3e45);
        m.metalness = 0.85;
        m.roughness = 0.35;
      } else if (this.look !== "original") {
        const l = LOOKS[this.look];
        m.color.set(l.color);
        m.metalness = l.metalness;
        m.roughness = l.roughness;
      } else {
        m.color.copy(p.fileColor ?? new THREE.Color(0xb8babd));
        m.metalness = p.fileColor ? 0.25 : 0.85;
        m.roughness = p.fileColor ? 0.55 : 0.32;
      }
      m.needsUpdate = true;
    }
    this.refreshHighlight();
  }

  ensureEdges(p: ViewerPart): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> {
    if (p.edges) return p.edges;
    const tris = (p.mesh.geometry.index as THREE.BufferAttribute).count / 3;
    const eg = tris > 800000 ? new THREE.BufferGeometry() : new THREE.EdgesGeometry(p.mesh.geometry, 28);
    p.edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x141a24, transparent: true, opacity: 0.55 }));
    p.edges.raycast = noRaycast;
    p.mesh.add(p.edges);
    return p.edges;
  }

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.applyDisplayMode();
  }

  private applyDisplayMode(): void {
    const mode = this.displayMode;
    for (const p of this.parts) {
      const m = p.mesh.material;
      const edges = mode !== "shaded" ? this.ensureEdges(p) : p.edges;
      m.transparent = mode === "xray" || mode === "wireframe";
      m.opacity = mode === "xray" ? 0.22 : mode === "wireframe" ? 0 : 1;
      m.depthWrite = !m.transparent;
      m.side = this.section.enabled ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
      if (edges) {
        edges.visible = mode !== "shaded";
        edges.material.opacity = mode === "wireframe" ? 0.9 : mode === "xray" ? 0.5 : 0.55;
      }
    }
    this.refreshHighlight();
  }

  setVisible(partIdxs: number[], visible: boolean): void {
    for (const i of partIdxs) {
      const p = this.parts[i];
      if (!p) continue;
      p.visible = visible;
      p.mesh.visible = visible;
    }
    const sel = this.selection;
    if (sel && sel.kind !== "assembly" && !this.parts[sel.part]?.visible) this.clearSelection();
    this.afterVisibility();
  }

  /** Toggle isolation of the given parts. Returns whether isolation is now on. */
  isolate(partIdxs: number[]): boolean {
    if (this.isolated) {
      const prev = this.isolated;
      this.parts.forEach((p, i) => {
        p.visible = prev[i];
        p.mesh.visible = p.visible;
      });
      this.isolated = null;
    } else {
      if (!partIdxs.length) return false;
      this.isolated = this.parts.map((p) => p.visible);
      this.parts.forEach((p, i) => {
        p.visible = partIdxs.includes(i);
        p.mesh.visible = p.visible;
      });
    }
    this.afterVisibility();
    return !!this.isolated;
  }

  private afterVisibility(): void {
    this.updateShadow();
    this.refreshAnnotations();
    this.emit("visibility");
    this.dirty = true;
  }

  setExplode(a: number): void {
    this.explode = a;
    for (const p of this.parts) p.mesh.position.copy(p.explodeDir).multiplyScalar(a);
    this.modelGroup.updateMatrixWorld(true);
    this.updateSectionPlane();
    this.refreshAnnotations();
    this.updateShadow();
    this.emit("explode", a);
  }

  // ---------- section ----------
  setSection(opts: Partial<SectionState>): void {
    Object.assign(this.section, opts);
    this.updateSectionPlane();
    this.applyDisplayMode();
    this.emit("section", { ...this.section });
  }

  private updateSectionPlane(): void {
    const box = this.modelBox(true);
    if (box.isEmpty()) return;
    const ax = this.section.axis;
    const n = new THREE.Vector3(ax === "x" ? 1 : 0, ax === "y" ? 1 : 0, ax === "z" ? 1 : 0);
    const v = THREE.MathUtils.lerp(box.min[ax], box.max[ax], this.section.t);
    // Keep the side below v unless flipped.
    if (this.section.flip) this.clipPlane.set(n, -v);
    else this.clipPlane.set(n.clone().negate(), v);
    this.sectionValue = v;
    this.dirty = true;
  }

  // ---------- camera ----------
  fit(animate = true, viewName?: ViewName | THREE.Vector3): void {
    let box = this.selection && this.fitToSelection ? this.selectionBox() : this.modelBox();
    this.fitToSelection = false;
    if (!box || box.isEmpty()) box = this.modelBox(true);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const dir = (viewName instanceof THREE.Vector3 ? viewName.clone() : viewName ? VIEW_DIRS[viewName].clone() : this.camera.position.clone().sub(this.controls.target)).normalize();
    const up = Math.abs(dir.z) > 0.99 ? new THREE.Vector3(0, dir.z > 0 ? 1 : -1, 0) : new THREE.Vector3(0, 0, 1);
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const upv = new THREE.Vector3().crossVectors(right, fwd).normalize();
    let W = 0, H = 0, Z = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const d = new THREE.Vector3(x, y, z).sub(center);
      W = Math.max(W, Math.abs(d.dot(right)));
      H = Math.max(H, Math.abs(d.dot(upv)));
      Z = Math.max(Z, d.dot(dir));
    }
    const vh = Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    const dist = Math.max(H / vh, W / (vh * (this.persp.aspect || 1))) * 1.12 + Z;
    this.flyTo(center, center.clone().add(dir.multiplyScalar(dist)), up, animate);
  }

  setView(name: ViewName): void {
    this.fit(true, name);
  }

  private flyTo(target: THREE.Vector3, position: THREE.Vector3, up: THREE.Vector3, animate: boolean): void {
    const cam = this.camera;
    if (!animate || this.reducedMotion) {
      this.controls.target.copy(target);
      cam.position.copy(position);
      cam.up.copy(up);
      if (cam instanceof THREE.OrthographicCamera) {
        this.persp.position.copy(position);
        this.updateOrthoFrustum();
        cam.zoom = 1;
        cam.updateProjectionMatrix();
      }
      cam.lookAt(target);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.tween = {
      t0: performance.now(),
      dur: 380,
      fromT: this.controls.target.clone(),
      toT: target.clone(),
      fromP: cam.position.clone(),
      toP: position.clone(),
      fromU: cam.up.clone(),
      toU: up.clone(),
    };
  }

  private stepTween(): void {
    const tw = this.tween;
    if (!tw) return;
    const cam = this.camera;
    const k = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
    const a = tw.fromP.clone().sub(tw.fromT), b = tw.toP.clone().sub(tw.toT);
    const la = a.length(), lb = b.length();
    const dir = a.normalize().lerp(b.normalize(), e);
    if (dir.lengthSq() < 1e-8) dir.copy(b);
    dir.normalize().multiplyScalar(THREE.MathUtils.lerp(la, lb, e));
    cam.position.copy(this.controls.target).add(dir);
    cam.up.lerpVectors(tw.fromU, tw.toU, e).normalize();
    if (cam instanceof THREE.OrthographicCamera) {
      this.persp.position.copy(cam.position);
      this.updateOrthoFrustum();
      cam.zoom = THREE.MathUtils.lerp(cam.zoom, 1, e);
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.controls.target);
    this.dirty = true;
    if (k >= 1) this.tween = null;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    const M = THREE.MOUSE;
    this.controls.mouseButtons = { LEFT: tool === "pan" ? M.PAN : tool === "zoom" ? M.DOLLY : M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN };
    this.controls.touches = { ONE: tool === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.updateCursor();
    if (tool !== "measure") this.clearMeasure();
  }

  private updateCursor(): void {
    const t = this.tool;
    this.renderer.domElement.style.cursor =
      t === "measure" ? "crosshair" : t === "pan" ? "grab" : t === "zoom" ? "zoom-in" : this.hovered != null && t === "select" ? "pointer" : "default";
  }

  // ---------- picking ----------
  private bindPointer(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number; t: number; b: number } | null = null;
    let pending = false;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(type, fn);
      this.unbind.push(() => el.removeEventListener(type, fn));
    };
    on("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button };
    });
    on("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      const b = down.b;
      down = null;
      if (moved < 5 && quick && b === 0) this.onClick(e);
    });
    on("dblclick", (e) => {
      if (this.hitTest(e)) {
        this.fitToSelection = true;
        this.fit(true);
      }
    });
    on("pointermove", (e) => {
      if (pending || e.buttons) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        this.onHover(e);
      }, 50);
    });
    on("pointerleave", () => this.setHover(null));
  }

  private ndc(e: MouseEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  hitTest(e: MouseEvent): Hit | null {
    if (!this.parts.length) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const meshes = this.parts.filter((p) => p.visible).map((p) => p.mesh);
    for (const h of this.raycaster.intersectObjects(meshes, false)) {
      if (this.section.enabled && this.clipPlane.distanceToPoint(h.point) < 0) continue;
      const p = this.parts[h.object.userData.partIndex as number];
      const fi = h.faceIndex ?? -1;
      const faceId = p.data && fi >= 0 ? p.data.faceOf[fi] : -1;
      return { part: p.index, faceIndex: fi, faceId, point: h.point.clone() };
    }
    return null;
  }

  private onHover(e: MouseEvent): void {
    const tris = this.parts.reduce((s, p) => s + (p.visible ? (p.mesh.geometry.index as THREE.BufferAttribute).count / 3 : 0), 0);
    if (tris > 1200000) return;
    this.setHover(this.hitTest(e));
  }

  private setHover(hit: Hit | null): void {
    const idx = hit ? hit.part : null;
    if (this.hovered === idx) return;
    this.hovered = idx;
    this.refreshHighlight();
    this.updateCursor();
    this.emit("hover", hit);
  }

  private onClick(e: MouseEvent): void {
    const hit = this.hitTest(e);
    if (this.tool === "measure") {
      if (hit) this.addMeasurePoint(hit);
      return;
    }
    if (!hit) {
      this.clearSelection();
      return;
    }
    const p = this.parts[hit.part];
    if (this.pick === "face" && hit.faceId >= 0) {
      this.select({ kind: "face", part: hit.part, faceId: hit.faceId });
      return;
    }
    if (this.pick === "feature" && hit.faceId >= 0 && p.data) {
      const f = p.data.features.find((f) => f.kind !== "pattern" && f.faceIds.includes(hit.faceId));
      if (f) {
        this.select({ kind: "feature", part: hit.part, feature: f.name });
        return;
      }
    }
    this.select({ kind: "part", part: hit.part });
  }

  // ---------- selection & highlight ----------
  select(sel: Selection | null, silent = false): void {
    this.selection = sel;
    this.refreshHighlight();
    this.refreshAnnotations();
    if (!silent) this.emit("select", sel);
  }

  clearSelection(): void {
    this.select(null);
  }

  featureOf(sel: Selection | null): Feature | null {
    if (!sel || sel.kind !== "feature") return null;
    return this.parts[sel.part]?.data?.features.find((f) => f.name === sel.feature) ?? null;
  }

  selectionBox(): THREE.Box3 | null {
    const sel = this.selection;
    if (!sel) return null;
    if (sel.kind === "assembly") {
      const box = new THREE.Box3();
      sel.parts.forEach((i) => {
        const p = this.parts[i];
        if (p?.visible) box.union(this.partBox(p));
      });
      return box;
    }
    const p = this.parts[sel.part];
    if (!p) return null;
    const faceIds = sel.kind === "face" ? [sel.faceId] : sel.kind === "feature" ? this.featureOf(sel)?.faceIds ?? [] : null;
    if (!faceIds || !p.data) return this.partBox(p);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    const { position: pos, index: idx } = p.src;
    for (const fid of faceIds) {
      for (const t of p.data.faces[fid].tris) {
        for (let k = 0; k < 3; k++) {
          const i = idx[t * 3 + k] * 3;
          box.expandByPoint(v.set(pos[i], pos[i + 1], pos[i + 2]));
        }
      }
    }
    return box.translate(p.mesh.position);
  }

  private clearOverlays(): void {
    this.overlayObjs.forEach(disposeObject);
    this.overlayObjs = [];
  }

  private refreshHighlight(): void {
    this.clearOverlays();
    const sel = this.selection;
    const selParts = sel ? (sel.kind === "assembly" ? sel.parts : [sel.part]) : [];
    const wireish = this.displayMode === "wireframe" || this.displayMode === "xray";
    for (const p of this.parts) {
      const m = p.mesh.material;
      const isSel = !!sel && (sel.kind === "part" || sel.kind === "assembly") && selParts.includes(p.index);
      const isHover = this.hovered === p.index && !isSel;
      m.emissive.set(isSel ? 0x0f6f8c : isHover ? 0x0b2a40 : 0x000000);
      m.emissiveIntensity = isSel ? 0.7 : 1;
      if (p.edges?.visible) p.edges.material.color.set(isSel ? 0x7fe9ff : wireish ? 0x9ad7ef : 0x141a24);
    }
    this.dirty = true;
    if (!sel || (sel.kind !== "face" && sel.kind !== "feature")) return;
    const p = this.parts[sel.part];
    if (!p?.data) return;
    const feat = this.featureOf(sel);
    const faceIds = sel.kind === "face" ? [sel.faceId] : feat?.faceIds ?? [];
    const tris: number[] = [];
    for (const fid of faceIds) tris.push(...p.data.faces[fid].tris);
    if (!tris.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", p.mesh.geometry.getAttribute("position"));
    const ix = new Uint32Array(tris.length * 3);
    const src = p.src.index;
    tris.forEach((t, k) => {
      ix[k * 3] = src[t * 3];
      ix[k * 3 + 1] = src[t * 3 + 1];
      ix[k * 3 + 2] = src[t * 3 + 2];
    });
    g.setIndex(new THREE.BufferAttribute(ix, 1));
    const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    fill.renderOrder = 5;
    fill.raycast = noRaycast;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0xb4f3ff, transparent: true, opacity: 0.95 }));
    edge.renderOrder = 6;
    edge.raycast = noRaycast;
    p.mesh.add(fill, edge);
    this.overlayObjs.push(fill, edge);
    // A hole's removed volume, drawn as a translucent cylinder.
    if (feat?.kind === "hole") {
      const ghost = new THREE.Group();
      const mk = (r: number, len: number, off: number) => {
        const cm = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, len, 48, 1, true),
          new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.14, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
        );
        cm.position.y = off;
        cm.renderOrder = 7;
        cm.raycast = noRaycast;
        const rings = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.CylinderGeometry(r, r, len, 48, 1, false), 30),
          new THREE.LineBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.8, depthTest: false }),
        );
        rings.position.y = off;
        rings.renderOrder = 8;
        rings.raycast = noRaycast;
        ghost.add(cm, rings);
      };
      const L = feat.length;
      if (feat.cbore) {
        mk(feat.cbore.radius, feat.cbore.depth, -feat.cbore.depth / 2);
        mk(feat.radius, L - feat.cbore.depth, -feat.cbore.depth - (L - feat.cbore.depth) / 2);
      } else mk(feat.radius, L, -L / 2);
      // Cylinder axis is +Y; point it from the entry outward.
      ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), feat.axis.clone().negate().normalize());
      ghost.position.copy(feat.entry);
      p.mesh.add(ghost);
      this.overlayObjs.push(ghost);
    }
  }

  // ---------- annotations ----------
  setAnnotations(on: boolean): void {
    this.annotations = on;
    this.refreshAnnotations();
  }

  refreshAnnotations(): void {
    this.annoObjs.forEach(disposeObject);
    this.annoObjs = [];
    const items: { point: THREE.Vector3; text: string; cls: string; leader?: { x: number; y: number } }[] = [];
    const add = (it: (typeof items)[number]) => items.push(it);
    if (this.annotations && this.parts.length) {
      const sel = this.selection;
      const feat = this.featureOf(sel);
      const box = sel && (sel.kind === "part" || sel.kind === "assembly") ? this.selectionBox() : this.modelBox();
      if (box && !box.isEmpty()) this.boxDims(box).forEach(add);
      if (sel && sel.kind === "feature" && feat) {
        const part = this.parts[sel.part];
        if (feat.kind === "hole") add(this.holeCallout(feat, part));
        else if (feat.kind === "fillet") add(this.faceCallout(feat, part, `R${this.units.len(feat.radius)}${feat.edges > 1 ? `  ${feat.edges}X` : ""}`));
        else if (feat.kind === "boss") add(this.faceCallout(feat, part, this.units.dia(feat.radius)));
      }
    }
    this.setLabels(items);
  }

  private line(points: THREE.Vector3[], color = 0xdfe6f2, opacity = 0.9): void {
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    l.renderOrder = 10;
    l.raycast = noRaycast;
    this.overlayGroup.add(l);
    this.annoObjs.push(l);
  }

  private boxDims(box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3());
    const d = size.length();
    const off = d * 0.08, tick = d * 0.025;
    const { min, max } = box;
    const segs: THREE.Vector3[] = [];
    const labels: { point: THREE.Vector3; text: string; cls: string }[] = [];
    const dim = (a: THREE.Vector3, b: THREE.Vector3, ext: THREE.Vector3, label: string) => {
      segs.push(a.clone(), a.clone().add(ext.clone().multiplyScalar(1.15)));
      segs.push(b.clone(), b.clone().add(ext.clone().multiplyScalar(1.15)));
      const a2 = a.clone().add(ext), b2 = b.clone().add(ext);
      segs.push(a2, b2);
      const dir = b2.clone().sub(a2).normalize();
      const side = ext.clone().normalize().multiplyScalar(tick * 0.5);
      for (const [p, s] of [[a2, 1], [b2, -1]] as const) {
        const back = p.clone().add(dir.clone().multiplyScalar(s * tick));
        segs.push(p.clone(), back.clone().add(side), p.clone(), back.clone().sub(side));
      }
      labels.push({ cls: "cad-dim", text: label, point: a2.clone().lerp(b2, 0.5).add(ext.clone().normalize().multiplyScalar(off * 0.45)) });
    };
    if (size.x > 1e-9) dim(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(0, -off, 0), this.units.len(size.x));
    if (size.y > 1e-9) dim(new THREE.Vector3(max.x, min.y, min.z), new THREE.Vector3(max.x, max.y, min.z), new THREE.Vector3(off, 0, 0), this.units.len(size.y));
    if (size.z > 1e-9) dim(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(-off * 0.7, -off * 0.7, 0), this.units.len(size.z));
    this.line(segs);
    return labels;
  }

  private holeCallout(feat: HoleFeature, part: ViewerPart) {
    const entry = feat.entry.clone().add(part.mesh.position);
    const ax = feat.axis.clone().normalize();
    const ref = Math.abs(ax.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const radial = ref.sub(ax.clone().multiplyScalar(ref.dot(ax))).normalize();
    const rim = entry.clone().add(radial.multiplyScalar(feat.cbore ? feat.cbore.radius : feat.radius));
    const d = part.data?.diag ?? 1;
    this.line([entry.clone().sub(ax.clone().multiplyScalar(d * 0.05)), entry.clone().add(ax.clone().multiplyScalar(feat.length + d * 0.05))], 0xcfd9ea, 0.45);
    const u = this.units;
    let text = `${(feat.patternCount ?? 0) > 1 ? `${feat.patternCount}X ` : ""}${u.dia(feat.radius)}\n${feat.thru || feat.depth == null ? "THRU ALL" : `↧ ${u.len(feat.depth)}`}`;
    if (feat.cbore) text += `\n⌴ ${u.dia(feat.cbore.radius)} ↧ ${u.len(feat.cbore.depth)}`;
    return { cls: "cad-callout", text, point: rim, leader: { x: 86, y: -78 } };
  }

  private faceCallout(feat: Feature, part: ViewerPart, text: string) {
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    const f = part.data?.faces[feat.faceIds[0]];
    let n = 0;
    for (const t of f?.tris.slice(0, 400) ?? []) {
      for (let k = 0; k < 3; k++) {
        const i = part.src.index[t * 3 + k] * 3;
        c.add(v.set(part.src.position[i], part.src.position[i + 1], part.src.position[i + 2]));
        n++;
      }
    }
    c.divideScalar(Math.max(1, n)).add(part.mesh.position);
    return { cls: "cad-callout", text, point: c, leader: { x: 80, y: -70 } };
  }

  private makeLabel(cls: string, text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = cls;
    for (const line of text.split("\n")) {
      const d = document.createElement("div");
      d.textContent = line;
      el.appendChild(d);
    }
    this.labelsEl.appendChild(el);
    return el;
  }

  private setLabels(items: { point: THREE.Vector3; text: string; cls: string; leader?: { x: number; y: number } }[]): void {
    this.labelItems.forEach((l) => l.el.remove());
    this.labelItems = items.map((it) => ({ el: this.makeLabel(it.cls, it.text), point: it.point, leader: it.leader }));
    this.dirty = true;
  }

  private updateLabels(): void {
    const all = this.labelItems.concat(this.measureLabels);
    let paths = "";
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = new THREE.Vector3();
    for (const l of all) {
      v.copy(l.point).project(this.camera);
      const visible = v.z < 1 && v.z > -1;
      l.el.style.display = visible ? "" : "none";
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (l.leader && visible) {
        const ex = Math.min(x + l.leader.x, w - 190), ey = Math.max(y + l.leader.y, 64);
        paths += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#e8f2ff"/><path d="M${x.toFixed(1)} ${y.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)} h18" stroke="#e8f2ff" stroke-width="1.4" fill="none"/>`;
        x = ex + 24;
        y = ey;
      }
      l.el.style.left = `${x}px`;
      l.el.style.top = `${y}px`;
    }
    this.leaderSvg.innerHTML = paths;
  }

  // ---------- measure ----------
  private addMeasurePoint(hit: Hit): void {
    if (this.measurePts.length >= 2) this.clearMeasure(true);
    const face = this.parts[hit.part]?.data?.faces[hit.faceId];
    this.measurePts.push({ ...hit, face });
    this.drawMeasure();
  }

  clearMeasure(silent = false): void {
    this.measureObjs.forEach(disposeObject);
    this.measureObjs = [];
    this.measureLabels.forEach((l) => l.el.remove());
    this.measureLabels = [];
    this.measurePts = [];
    if (!silent) this.emit("measure", null);
    this.dirty = true;
  }

  private drawMeasure(): void {
    const pts = this.measurePts;
    this.measureObjs.forEach(disposeObject);
    this.measureObjs = [];
    this.measureLabels.forEach((l) => l.el.remove());
    this.measureLabels = pts.map((p) => ({ el: this.makeLabel("cad-mpt", ""), point: p.point }));
    let result: MeasureResult | null = null;
    if (pts.length === 2) {
      const [a, b] = pts;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a.point, b.point]), new THREE.LineBasicMaterial({ color: 0xf5c542, depthTest: false, transparent: true }));
      l.renderOrder = 12;
      this.overlayGroup.add(l);
      this.measureObjs.push(l);
      const delta = b.point.clone().sub(a.point);
      const distance = delta.length();
      this.measureLabels.push({ el: this.makeLabel("cad-callout cad-mlabel", this.units.len(distance)), point: a.point.clone().lerp(b.point, 0.5) });
      result = { distance, delta };
      // Parallel planar faces: report the true gap between them.
      if (a.face?.type === "plane" && b.face?.type === "plane" && (a.part !== b.part || a.faceId !== b.faceId) && Math.abs(a.face.normal.dot(b.face.normal)) > 0.9999) {
        result.planeGap = Math.abs(delta.dot(a.face.normal));
      }
    }
    this.emit("measure", { points: pts, result });
    this.dirty = true;
  }

  // ---------- ground shadow ----------
  private makeShadow(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(0,0,0,0.65)");
      grd.addColorStop(0.55, "rgba(0,0,0,0.25)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.renderOrder = -1;
    m.raycast = noRaycast;
    return m;
  }

  private updateShadow(): void {
    const box = this.modelBox();
    this.shadow.visible = !box.isEmpty();
    if (box.isEmpty()) return;
    const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    this.shadow.position.set(c.x, c.y, box.min.z - s.length() * 0.002);
    this.shadow.scale.set(s.x * 1.9 + s.length() * 0.2, s.y * 1.9 + s.length() * 0.2, 1);
    this.dirty = true;
  }

  // ---------- view cube & triad ----------
  private initViewCube(host: HTMLElement): void {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(110, 110, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 20);
    cam.up.set(0, 0, 1);
    const faceMat = (label: string, rot: number) => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      if (g) {
        const grd = g.createLinearGradient(0, 0, 128, 128);
        grd.addColorStop(0, "#1a3352");
        grd.addColorStop(1, "#0f2138");
        g.fillStyle = grd;
        g.fillRect(0, 0, 128, 128);
        g.strokeStyle = "#3ee0ff";
        g.globalAlpha = 0.55;
        g.lineWidth = 4;
        g.strokeRect(2, 2, 124, 124);
        g.globalAlpha = 1;
        g.fillStyle = "#e8f2ff";
        g.font = "600 25px 'IBM Plex Sans', system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, 64, 66);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.center.set(0.5, 0.5);
      t.rotation = rot;
      return new THREE.MeshBasicMaterial({ map: t });
    };
    // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
    const mats = [faceMat("Right", Math.PI / 2), faceMat("Left", -Math.PI / 2), faceMat("Back", Math.PI), faceMat("Front", 0), faceMat("Top", 0), faceMat("Bottom", 0)];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), mats);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x3ee0ff, transparent: true, opacity: 0.6 })));
    scene.add(mesh);
    this.cube = { renderer, scene, cam, mesh };
    const dirs: ViewName[] = ["right", "left", "back", "front", "top", "bottom"];
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(v, cam);
      const h = rc.intersectObject(mesh, false)[0];
      if (!h || !h.face) return;
      // Clicks near an edge or corner give a combined direction.
      const p = h.point.clone().divideScalar(0.85);
      const dir = new THREE.Vector3(Math.abs(p.x) > 0.6 ? Math.sign(p.x) : 0, Math.abs(p.y) > 0.6 ? Math.sign(p.y) : 0, Math.abs(p.z) > 0.6 ? Math.sign(p.z) : 0);
      const nonZero = [dir.x, dir.y, dir.z].filter((x) => x !== 0).length;
      if (nonZero <= 1) this.setView(dirs[h.face.materialIndex]);
      else this.fit(true, dir);
    };
    renderer.domElement.addEventListener("click", onClick);
    this.unbind.push(() => renderer.domElement.removeEventListener("click", onClick));
  }

  private renderViewCube(): void {
    if (!this.cube) return;
    const { renderer, scene, cam } = this.cube;
    cam.position.copy(this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(6));
    cam.up.copy(this.camera.up);
    cam.lookAt(0, 0, 0);
    renderer.render(scene, cam);
  }

  private drawTriad(): void {
    if (!this.triadEl) return;
    const q = this.camera.quaternion.clone().invert();
    const c = 45, L = 30;
    const items = (
      [
        ["X", new THREE.Vector3(1, 0, 0), "#ff4d5a"],
        ["Y", new THREE.Vector3(0, 1, 0), "#34e28a"],
        ["Z", new THREE.Vector3(0, 0, 1), "#3ee0ff"],
      ] as const
    )
      .map(([n, v, col]) => {
        const s = v.clone().applyQuaternion(q);
        return { n, col, x: c + s.x * L, y: c - s.y * L, z: s.z };
      })
      .sort((a, b) => a.z - b.z);
    this.triadEl.innerHTML = items
      .map(
        (a) =>
          `<line x1="${c}" y1="${c}" x2="${a.x.toFixed(1)}" y2="${a.y.toFixed(1)}" stroke="${a.col}" stroke-width="2.4" stroke-linecap="round"/>` +
          `<text x="${(c + (a.x - c) * 1.32).toFixed(1)}" y="${(c + (a.y - c) * 1.32 + 5).toFixed(1)}" fill="#e8f2ff" font-size="14" text-anchor="middle">${a.n}</text>`,
      )
      .join("");
  }
}
