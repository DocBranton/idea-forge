// Renders a B-size engineering drawing sheet from what the viewer shows:
// third-angle front, top and right views plus an isometric, hidden lines removed,
// overall dimensions, hole callouts, a zoned border and a title block.
// Ported from c-engineering-workbench js/drawing.js. Browser only (WebGL + canvas).
import * as THREE from "three";
import { drawingAnnotations, type DrawingCallout, type DrawingPart, type ViewAxis } from "./drawing";
import type { Viewer, ViewerPart } from "./viewer";
import type { Units } from "./units";

export const SHEET_W = 2400;
export const SHEET_H = 1550;
const INK = "#141414";
const FONT = "'IBM Plex Sans', Arial, sans-serif";

export interface SheetMeta {
  title: string;
  partNumber?: string;
  rev?: string;
  material: string;
}

let gl: THREE.WebGLRenderer | null = null;
function renderer(): THREE.WebGLRenderer {
  if (!gl) {
    gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    gl.setPixelRatio(1);
  }
  return gl;
}

/** Free the offscreen WebGL context. Safe to call more than once. */
export function disposeDrawingRenderer(): void {
  gl?.dispose();
  gl = null;
}

export function drawingParts(parts: readonly ViewerPart[]): DrawingPart[] {
  return parts.map((p) => ({
    name: p.name,
    visible: p.visible,
    offset: p.mesh.position.clone(),
    box: (p.mesh.geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(p.mesh.geometry.getAttribute("position") as THREE.BufferAttribute)).clone(),
    data: p.data,
  }));
}

// Back faces pushed out along their normals draw silhouettes of curved surfaces.
function outlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uThick = { value: thickness };
    sh.vertexShader = "uniform float uThick;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * uThick;");
  };
  return m;
}

function buildScene(viewer: Viewer, pxPerUnit: number): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const fill = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
  const ink = new THREE.LineBasicMaterial({ color: 0x141414 });
  const outline = outlineMaterial(1.1 / pxPerUnit);
  for (const p of viewer.parts) {
    if (!p.visible) continue;
    const g = p.mesh.geometry;
    for (const obj of [new THREE.Mesh(g, outline), new THREE.Mesh(g, fill), new THREE.LineSegments(viewer.ensureEdges(p).geometry, ink)]) {
      obj.position.copy(p.mesh.position);
      scene.add(obj);
    }
  }
  // Geometry is shared with the viewer; only the drawing materials are ours.
  return { scene, dispose: () => [fill, ink, outline].forEach((m) => m.dispose()) };
}

function renderView(viewer: Viewer, scene: THREE.Scene, box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, w: number, h: number, pxPerUnit: number, pad: number): HTMLCanvasElement {
  const r = renderer();
  const c = box.getCenter(new THREE.Vector3());
  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  const hw = (w / 2 + pad) / pxPerUnit, hh = (h / 2 + pad) / pxPerUnit;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.001, diag * 4);
  cam.up.copy(up);
  cam.position.copy(c).add(dir.clone().normalize().multiplyScalar(diag * 2));
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  r.setSize(Math.max(1, Math.round(w + pad * 2)), Math.max(1, Math.round(h + pad * 2)), false);
  r.clippingPlanes = viewer.section.enabled ? [viewer.clipPlane] : [];
  r.render(scene, cam);
  return r.domElement;
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, ang: number, size = 14): void {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - size * Math.cos(ang - 0.28), y - size * Math.sin(ang - 0.28));
  g.lineTo(x - size * Math.cos(ang + 0.28), y - size * Math.sin(ang + 0.28));
  g.closePath();
  g.fill();
}

type P2 = { x: number; y: number };

/** Linear dimension between sheet points a and b, offset perpendicular by `off` px. */
function dimension(g: CanvasRenderingContext2D, a: P2, b: P2, off: number, text: string): void {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 2) return;
  const nx = -dy / L, ny = dx / L, s = Math.sign(off);
  const A = { x: a.x + nx * off, y: a.y + ny * off }, B = { x: b.x + nx * off, y: b.y + ny * off };
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(a.x + nx * s * 6, a.y + ny * s * 6);
  g.lineTo(A.x + nx * s * 10, A.y + ny * s * 10);
  g.moveTo(b.x + nx * s * 6, b.y + ny * s * 6);
  g.lineTo(B.x + nx * s * 10, B.y + ny * s * 10);
  g.stroke();
  const ang = Math.atan2(dy, dx);
  g.font = `500 24px ${FONT}`;
  const tw = g.measureText(text).width + 16;
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const roomy = L > tw + 40;
  g.beginPath();
  if (roomy) {
    g.moveTo(A.x, A.y);
    g.lineTo(mid.x - ((dx / L) * tw) / 2, mid.y - ((dy / L) * tw) / 2);
    g.moveTo(mid.x + ((dx / L) * tw) / 2, mid.y + ((dy / L) * tw) / 2);
    g.lineTo(B.x, B.y);
  } else {
    g.moveTo(A.x, A.y);
    g.lineTo(B.x, B.y);
  }
  g.stroke();
  arrow(g, A.x, A.y, ang + Math.PI);
  arrow(g, B.x, B.y, ang);
  g.save();
  g.translate(mid.x, mid.y);
  let rot = ang;
  if (rot > Math.PI / 2 || rot < -Math.PI / 2) rot += Math.PI;
  g.rotate(rot);
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (!roomy) g.translate(0, -18);
  g.fillText(text, 0, 1);
  g.restore();
}

function leader(g: CanvasRenderingContext2D, from: P2, to: P2, lines: string[]): void {
  g.lineWidth = 1.2;
  const dir = to.x >= from.x ? 1 : -1;
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo(to.x, to.y);
  g.lineTo(to.x + dir * 24, to.y);
  g.stroke();
  arrow(g, from.x, from.y, Math.atan2(from.y - to.y, from.x - to.x), 13);
  g.font = `500 22px ${FONT}`;
  g.textAlign = dir > 0 ? "left" : "right";
  g.textBaseline = "middle";
  lines.forEach((t, i) => g.fillText(t, to.x + dir * 30, to.y + (i - (lines.length - 1) / 2) * 26));
}

interface View {
  name: string;
  pos: P2;
  w: number;
  h: number;
  dir: THREE.Vector3;
  up: THREE.Vector3;
  /** Axis a hole must run along to appear as a circle in this view. */
  axis: ViewAxis;
  map: (p: { x?: number; y?: number; z?: number }) => P2;
}

/** Draw the sheet. Returns a canvas the caller can show or export. */
export function generateDrawing(viewer: Viewer, units: Units, meta: SheetMeta): HTMLCanvasElement {
  const sheet = document.createElement("canvas");
  sheet.width = SHEET_W;
  sheet.height = SHEET_H;
  const g = sheet.getContext("2d");
  if (!g) throw new Error("Canvas 2D is not available in this browser.");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, SHEET_W, SHEET_H);

  // Border with zone markers.
  const M = 40;
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 3;
  g.strokeRect(M, M, SHEET_W - 2 * M, SHEET_H - 2 * M);
  g.lineWidth = 1;
  g.strokeRect(M - 18, M - 18, SHEET_W - 2 * M + 36, SHEET_H - 2 * M + 36);
  g.font = `500 18px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < 8; i++) {
    const x = M + ((i + 0.5) * (SHEET_W - 2 * M)) / 8;
    g.fillText(String(8 - i), x, M - 9);
    g.fillText(String(8 - i), x, SHEET_H - M + 9);
  }
  for (let j = 0; j < 4; j++) {
    const y = M + ((j + 0.5) * (SHEET_H - 2 * M)) / 4;
    g.fillText("DCBA"[j], M - 9, y);
    g.fillText("DCBA"[j], SHEET_W - M + 9, y);
  }

  const notes = drawingAnnotations(drawingParts(viewer.parts), units);
  const box = notes.envelope;
  if (box.isEmpty()) {
    drawTitleBlock(g, units, meta, M, viewer, null);
    g.font = `500 28px ${FONT}`;
    g.textAlign = "center";
    g.fillText("Nothing is visible. Show at least one part to generate the drawing.", SHEET_W / 2, SHEET_H / 2 - 80);
    return sheet;
  }
  const size = notes.size;

  // Layout and one common scale for the orthographic views.
  const areaX = M + 120, areaY = M + 90, areaW = 1420, areaH = SHEET_H - 2 * M - 200, gap = 150;
  const s = Math.min((areaW - gap) / Math.max(size.x + size.y, 1e-9), (areaH - gap) / Math.max(size.z + size.y, 1e-9));
  const fw = size.x * s, fh = size.z * s, th = size.y * s, rw = size.y * s;
  const pad = 6;
  const topPos = { x: areaX, y: areaY };
  const frontPos = { x: areaX, y: areaY + th + gap };
  const rightPos = { x: areaX + fw + gap, y: frontPos.y };
  const { min, max } = box;
  const views: View[] = [
    { name: "FRONT", pos: frontPos, w: fw, h: fh, dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1), axis: "y", map: (p) => ({ x: frontPos.x + ((p.x ?? 0) - min.x) * s, y: frontPos.y + (max.z - (p.z ?? 0)) * s }) },
    { name: "TOP", pos: topPos, w: fw, h: th, dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), axis: "z", map: (p) => ({ x: topPos.x + ((p.x ?? 0) - min.x) * s, y: topPos.y + (max.y - (p.y ?? 0)) * s }) },
    { name: "RIGHT", pos: rightPos, w: rw, h: fh, dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1), axis: "x", map: (p) => ({ x: rightPos.x + ((p.y ?? 0) - min.y) * s, y: rightPos.y + (max.z - (p.z ?? 0)) * s }) },
  ];
  const { scene, dispose } = buildScene(viewer, s);
  try {
    for (const v of views) {
      if (v.w < 2 || v.h < 2) continue;
      g.drawImage(renderView(viewer, scene, box, v.dir, v.up, v.w, v.h, s, pad), v.pos.x - pad, v.pos.y - pad);
    }
    // Isometric, upper right, at its own scale.
    const iso = { x: areaX + areaW + 40, y: areaY, w: SHEET_W - M - 40 - (areaX + areaW + 40), h: 520 };
    const dir = new THREE.Vector3(0.95, -1.35, 0.9).normalize();
    const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 0, 1)).normalize();
    const upv = new THREE.Vector3().crossVectors(right, dir.clone().negate()).normalize();
    const c = box.getCenter(new THREE.Vector3());
    let wU = 0, hU = 0;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const d = new THREE.Vector3(x, y, z).sub(c);
      wU = Math.max(wU, Math.abs(d.dot(right)));
      hU = Math.max(hU, Math.abs(d.dot(upv)));
    }
    const si = Math.min(iso.w / (2 * wU), iso.h / (2 * hU)) * 0.9;
    const img = renderView(viewer, scene, box, dir, new THREE.Vector3(0, 0, 1), 2 * wU * si, 2 * hU * si, si, pad);
    g.drawImage(img, iso.x + (iso.w - img.width) / 2, iso.y + (iso.h - img.height) / 2);
    label(g, "ISOMETRIC", iso.x + iso.w / 2, iso.y + iso.h + 24);
  } finally {
    dispose();
  }

  label(g, "TOP", topPos.x + fw / 2, topPos.y - 28);
  label(g, "FRONT", frontPos.x + fw / 2, frontPos.y + fh + 110);
  label(g, "RIGHT", rightPos.x + rw / 2, rightPos.y + fh + 110);

  // Overall dimensions.
  g.strokeStyle = INK;
  g.fillStyle = INK;
  const [fv, tv, rv] = views;
  dimension(g, fv.map({ x: min.x, z: min.z }), fv.map({ x: max.x, z: min.z }), 60, notes.dimensions.x);
  dimension(g, fv.map({ x: min.x, z: min.z }), fv.map({ x: min.x, z: max.z }), -60, notes.dimensions.z);
  dimension(g, rv.map({ y: min.y, z: min.z }), rv.map({ y: max.y, z: min.z }), 60, notes.dimensions.y);
  dimension(g, tv.map({ x: min.x, y: min.y }), tv.map({ x: min.x, y: max.y }), -60, notes.dimensions.y);

  drawCallouts(g, notes.callouts, views, s);
  drawTitleBlock(g, units, meta, M, viewer, s);
  return sheet;
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.font = `600 20px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = INK;
  g.fillText(text, x, y);
}

/**
 * Leaders from each hole, in the view where it appears round. Text goes outside the
 * views so it never sits on geometry: right of the top view, and in the gap above
 * the front and right views. Stacked callouts step away from each other.
 */
function drawCallouts(g: CanvasRenderingContext2D, callouts: DrawingCallout[], views: View[], s: number): void {
  for (const v of views) {
    const items = callouts
      .filter((co) => co.axis === v.axis)
      .map((co) => {
        const c2 = v.map(co.center);
        const r = co.radius * s;
        return { co, from: { x: c2.x + Math.cos(-Math.PI / 4) * r, y: c2.y + Math.sin(-Math.PI / 4) * r } };
      });
    if (!items.length) continue;
    if (v.name === "TOP") {
      // Text column to the right of the view, in the holes' top-to-bottom order.
      items.sort((a, b) => a.from.y - b.from.y);
      items.forEach(({ co, from }, k) => leader(g, from, { x: v.pos.x + v.w + 40, y: Math.max(v.pos.y + 30, from.y - 40) + k * 64 }, co.lines));
    } else {
      // Rows in the gap above the view. The lowest hole takes the nearest row and
      // the furthest-right text, so leaders fan out without crossing.
      items.sort((a, b) => b.from.y - a.from.y);
      const baseX = Math.max(...items.map((i) => i.from.x)) + 60;
      items.forEach(({ co, from }, k) => leader(g, from, { x: baseX + (items.length - 1 - k) * 220, y: v.pos.y - 40 - k * 60 }, co.lines));
    }
  }
}

function drawTitleBlock(g: CanvasRenderingContext2D, units: Units, meta: SheetMeta, M: number, viewer: Viewer, s: number | null): void {
  const tbW = 760, tbH = 262;
  const x0 = SHEET_W - M - tbW, y0 = SHEET_H - M - tbH;
  g.fillStyle = "#fff";
  g.fillRect(x0, y0, tbW, tbH);
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(x0, y0, tbW, tbH);
  g.lineWidth = 1;
  const rows = 5, rh = tbH / rows;
  for (let i = 1; i < rows; i++) {
    g.beginPath();
    g.moveTo(x0, y0 + i * rh);
    g.lineTo(x0 + tbW, y0 + i * rh);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(x0 + tbW / 2, y0 + rh);
  g.lineTo(x0 + tbW / 2, y0 + rh * 4);
  g.stroke();
  const cell = (cx: number, cy: number, k: string, val: string, big = false) => {
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = `500 15px ${FONT}`;
    g.fillStyle = "#555";
    g.fillText(k, cx + 12, cy + 8);
    g.font = `${big ? 600 : 500} ${big ? 26 : 20}px ${FONT}`;
    g.fillStyle = INK;
    g.fillText(val, cx + 12, cy + 26, tbW / (big ? 1 : 2) - 24);
  };
  // B-size sheet is 17 in wide: compare sheet pixels per real inch with pixels per paper inch.
  let scaleText = "—";
  if (s) {
    const nominal = (s * 25.4) / units.mmPerUnit / (SHEET_W / 17);
    scaleText = nominal >= 1 ? `${nominal.toFixed(nominal >= 10 ? 0 : 1)}:1` : `1:${(1 / nominal).toFixed(1 / nominal >= 10 ? 0 : 1)}`;
  }
  cell(x0, y0, "TITLE", meta.title, true);
  cell(x0, y0 + rh, "PART NO.", meta.partNumber || "—");
  cell(x0 + tbW / 2, y0 + rh, "REV", meta.rev || "—");
  cell(x0, y0 + rh * 2, "MATERIAL", meta.material);
  cell(x0 + tbW / 2, y0 + rh * 2, "UNITS / SCALE (B SIZE)", `${units.display === "in" ? "INCHES" : "MILLIMETERS"}  ${scaleText}`);
  cell(x0, y0 + rh * 3, "PROJECTION", "THIRD ANGLE");
  cell(x0 + tbW / 2, y0 + rh * 3, "DATE", new Date().toISOString().slice(0, 10));
  cell(x0, y0 + rh * 4, "STATUS", "GENERATED FROM CAD — NOT A RELEASED DRAWING", true);
  if (viewer.section.enabled && s) {
    g.font = `500 18px ${FONT}`;
    g.fillStyle = "#555";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    g.fillText(`SECTION ${viewer.section.axis.toUpperCase()} = ${units.len(viewer.sectionValue, false)}`, M + 120, SHEET_H - M - 16);
  }
}
