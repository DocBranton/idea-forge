// Reads CAD and mesh files in the browser into a ModelData description.
// STEP/IGES/BREP go to the OpenCascade worker (client/public/cad/occt-worker.js);
// STL/OBJ/glTF use the three.js loaders. Ported from c-engineering-workbench js/loaders.js.
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { MeshData, ModelData, ModelNode } from "./types";

export const CAD_EXTENSIONS = ["step", "stp", "iges", "igs", "brep", "brp", "stl", "obj", "glb", "gltf"];

type WorkerReply = { id: number; progress?: string; result?: { root: ModelNode | null; meshes: MeshData[] }; error?: string };
type Pending = { resolve: (r: { root: ModelNode | null; meshes: MeshData[] }) => void; reject: (e: Error) => void; onProgress?: (m: string) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function occtWorker(): Worker {
  if (worker) return worker;
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  worker = new Worker(`${base.replace(/\/?$/, "/")}cad/occt-worker.js`);
  worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
    const { id, progress, result, error } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress) {
      p.onProgress?.(progress);
      return;
    }
    pending.delete(id);
    if (error || !result) p.reject(new Error(error || "The CAD kernel returned no result."));
    else p.resolve(result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`The CAD kernel failed to start: ${e.message || "worker error"}`));
    pending.clear();
    worker = null;
  };
  return worker;
}

function runOcct(format: "step" | "iges" | "brep", buffer: ArrayBuffer, onProgress?: (m: string) => void) {
  return new Promise<{ root: ModelNode | null; meshes: MeshData[] }>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    occtWorker().postMessage({ id, format, buffer }, [buffer]);
  });
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, "");

export async function loadCadFile(file: File, onProgress: (msg: string) => void = () => {}): Promise<ModelData> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "sldprt" || ext === "sldasm") {
    throw new Error("SolidWorks files can't be read directly. Export the part as STEP (.step) and open that.");
  }
  if (!CAD_EXTENSIONS.includes(ext)) {
    throw new Error(`.${ext} files aren't supported. Open a STEP, IGES, BREP, STL, OBJ or glTF file.`);
  }
  onProgress(`Reading ${file.name}`);
  const buffer = await file.arrayBuffer();
  const name = baseName(file.name);

  if (["step", "stp", "iges", "igs", "brep", "brp"].includes(ext)) {
    const format = ext.startsWith("st") ? "step" : ext.startsWith("ig") ? "iges" : "brep";
    const res = await runOcct(format, buffer, onProgress);
    if (!res.meshes.length) throw new Error("The file was read, but it contains no solid or surface geometry to display.");
    const root: ModelNode = res.root ?? { name, meshes: res.meshes.map((_, i) => i), children: [] };
    if (!root.name) root.name = name;
    const walk = (n: ModelNode) => {
      n.meshes.forEach((i, k) => {
        if (!res.meshes[i].name) res.meshes[i].name = n.meshes.length > 1 ? `${n.name || "Body"} ${k + 1}` : n.name || `Body ${i + 1}`;
      });
      n.children.forEach(walk);
    };
    walk(root);
    return { name: root.name || name, fileName: file.name, mmPerUnit: 1, format: format.toUpperCase(), root, meshes: res.meshes };
  }

  if (ext === "stl") {
    const geo = new STLLoader().parse(buffer);
    return { name, fileName: file.name, mmPerUnit: 1, format: "STL", meshOnly: true, root: { name, meshes: [0], children: [] }, meshes: [fromGeometry(geo, name)] };
  }

  if (ext === "obj") {
    const obj = new OBJLoader().parse(new TextDecoder().decode(buffer));
    return fromObject3D(obj, name, file.name, 1, "OBJ");
  }

  const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    new GLTFLoader().parse(buffer, "", resolve, (e) =>
      reject(new Error(`glTF could not be read: ${e.message || "invalid file"}. Use a .glb or a .gltf with embedded buffers.`)),
    );
  });
  // glTF is in metres.
  return fromObject3D(gltf.scene, name, file.name, 1000, "glTF");
}

function fromGeometry(geo: THREE.BufferGeometry, name: string, matrix?: THREE.Matrix4, color?: number[] | null): MeshData {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  const pos = g.getAttribute("position");
  const count = pos.count;
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    position[i * 3] = pos.getX(i);
    position[i * 3 + 1] = pos.getY(i);
    position[i * 3 + 2] = pos.getZ(i);
  }
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  return { name, color: color ?? null, position, normal: null, index, brepFaces: null };
}

function fromObject3D(rootObj: THREE.Object3D, name: string, fileName: string, mmPerUnit: number, format: string): ModelData {
  rootObj.updateMatrixWorld(true);
  const meshes: MeshData[] = [];
  const build = (o: THREE.Object3D, fallback: string): ModelNode => {
    const node: ModelNode = { name: o.name || fallback, meshes: [], children: [] };
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute("position")) {
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
      const c = mat?.color ? [mat.color.r, mat.color.g, mat.color.b] : null;
      meshes.push(fromGeometry(mesh.geometry, o.name || fallback, o.matrixWorld, c));
      node.meshes.push(meshes.length - 1);
    }
    o.children.forEach((ch, i) => {
      const n = build(ch, `${node.name} ${i + 1}`);
      if (n.meshes.length || n.children.length) node.children.push(n);
    });
    // Collapse unnamed groups that only wrap one node.
    if (!node.meshes.length && node.children.length === 1 && !o.name) return node.children[0];
    return node;
  };
  const root = build(rootObj, name);
  root.name = root.name || name;
  if (!meshes.length) throw new Error("The file contains no mesh geometry.");
  return { name, fileName, mmPerUnit, format, root, meshes, meshOnly: true };
}
