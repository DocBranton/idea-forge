import type { ReactNode } from "react";
import * as THREE from "three";
import { Check, Link2, X } from "lucide-react";
import type { Feature, ModelData, ReviewStatus } from "./engine/types";
import type { Selection, ViewerPart } from "./engine/viewer";
import type { Units } from "./engine/units";
import { featureLabel, MATERIALS, reviewKey } from "./labels";
import { historyFor, type CadSession, type HistoryEntry, type LinkMap } from "./links";
import type { LinkableRequirement } from "./CadWorkspace";

type Row = [string, ReactNode] | null | false;

function KV({ rows }: { rows: Row[] }) {
  return (
    <dl className="cad-kv">
      {rows.filter((r): r is [string, ReactNode] => !!r).map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function axisText(a: THREE.Vector3): string {
  const n = a.clone().normalize();
  const hit = ([["X", n.x], ["Y", n.y], ["Z", n.z]] as const).find(([, c]) => Math.abs(c) > 0.9995);
  return hit ? `${hit[1] > 0 ? "+" : "−"}${hit[0]} axis` : `(${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)})`;
}

const boxText = (b: THREE.Box3, u: Units) => {
  const s = b.getSize(new THREE.Vector3());
  return `${u.len(s.x, false)} × ${u.len(s.y, false)} × ${u.len(s.z, false)} ${u.display}`;
};

const STATUS_CLASS: Record<ReviewStatus, string> = { Inferred: "review", Validated: "ok", Rejected: "gap" };

export function CadDetails({
  model,
  parts,
  units,
  selection,
  featureOf,
  reviews,
  onReview,
  materialIdx,
  onMaterial,
  onSelect,
  requirements,
  session,
  onLink,
  storageNote,
}: {
  model: ModelData;
  parts: ViewerPart[];
  units: Units;
  selection: Selection | null;
  featureOf: (s: Selection | null) => Feature | null;
  reviews: Readonly<Record<string, ReviewStatus>>;
  onReview: (key: string, status: ReviewStatus) => void;
  requirements?: readonly LinkableRequirement[];
  session: CadSession;
  onLink: (featureKey: string, requirement: string, add: boolean) => void;
  storageNote?: string;
  materialIdx: number;
  onMaterial: (i: number) => void;
  onSelect: (s: Selection) => void;
}) {
  const links = session.links;
  const mat = MATERIALS[materialIdx];
  const mass = (vol: number) => units.mass(units.massGrams(vol, mat.density));
  const ready = parts.every((p) => p.data);
  const link = (label: string, sel: Selection) => (
    <button type="button" className="cad-link" onClick={() => onSelect(sel)}>
      {label}
    </button>
  );

  if (!selection || selection.kind === "assembly") {
    const idxs = selection?.kind === "assembly" ? selection.parts : parts.map((p) => p.index);
    let vol = 0, area = 0, tris = 0;
    const box = new THREE.Box3();
    idxs.forEach((i) => {
      const d = parts[i]?.data;
      if (!d) return;
      vol += d.volume;
      area += d.area;
      tris += d.triangles;
      box.union(d.box.clone().translate(parts[i].mesh.position));
    });
    const feats = idxs.flatMap((i) => parts[i]?.data?.features ?? []);
    const counts = new Map<ReviewStatus, number>();
    idxs.forEach((i) =>
      (parts[i]?.data?.features ?? []).forEach((f) => {
        const s = reviews[reviewKey(parts[i].name, f.name)] ?? "Inferred";
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }),
    );
    return (
      <div className="cad-details">
        <h4>{selection?.kind === "assembly" ? "Assembly" : "Model"}</h4>
        <div className="cad-title">{selection?.kind === "assembly" ? selection.name : model.name}</div>
        <KV
          rows={[
            !selection && ["Source", model.fileName],
            !selection && ["Format", model.format],
            ["Parts", String(idxs.length)],
            ready && ["Envelope", boxText(box, units)],
            ready && ["Volume", units.vol(vol)],
            ready && ["Surface area", units.area(area)],
            ready && ["Mass", mass(vol)],
            ["Triangles", tris.toLocaleString()],
            ["Features", ready ? `${feats.length} recognized` : "Analyzing…"],
            feats.length > 0 && ["Review", ["Validated", "Inferred", "Rejected"].filter((s) => counts.get(s as ReviewStatus)).map((s) => `${counts.get(s as ReviewStatus)} ${s.toLowerCase()}`).join(", ")],
            !!requirements && feats.length > 0 && ["Traceability", linkSummary(links)],
            !!storageNote && feats.length > 0 && ["Reviews", storageNote],
          ]}
        />
        <label className="cad-field">
          <span>Material for mass</span>
          <select value={materialIdx} onChange={(e) => onMaterial(Number(e.target.value))}>
            {MATERIALS.map((m, i) => (
              <option key={m.name} value={i}>
                {m.name} ({m.density} g/cm³)
              </option>
            ))}
          </select>
        </label>
        <p className="muted cad-note">
          Recognized features are proposals from the geometry. Select one to validate or reject it. Files are read in this browser and are not uploaded.
        </p>
      </div>
    );
  }

  const part = parts[selection.part];
  if (!part) return null;
  const d = part.data;

  if (selection.kind === "face") {
    const f = d?.faces[selection.faceId];
    if (!f) return null;
    const owner = d?.features.find((x) => x.kind !== "pattern" && x.faceIds.includes(selection.faceId));
    return (
      <div className="cad-details">
        <h4>Face</h4>
        <div className="cad-title">Face {selection.faceId + 1}</div>
        <KV
          rows={[
            ["Type", f.type === "plane" ? "Planar" : f.type === "cylinder" ? "Cylindrical" : "Freeform or other"],
            ["Area", units.area(f.area)],
            f.type === "plane" && ["Normal", axisText(f.normal)],
            f.type === "cylinder" && ["Diameter", units.dia(f.radius)],
            f.type === "cylinder" && ["Axis", axisText(f.axis)],
            f.type === "cylinder" && ["Sweep", `${THREE.MathUtils.radToDeg(f.sweep).toFixed(1)}°`],
            f.type === "cylinder" && ["Side", f.concave ? "Inside (hole-like)" : "Outside (shaft-like)"],
            ["Part", link(part.name, { kind: "part", part: part.index })],
            owner ? ["Feature", link(`${owner.name} · ${featureLabel(owner, units)}`, { kind: "feature", part: part.index, feature: owner.name })] : null,
          ]}
        />
      </div>
    );
  }

  if (selection.kind === "part") {
    const counts: Record<string, number> = {};
    (d?.features ?? []).forEach((f) => {
      counts[f.type] = (counts[f.type] ?? 0) + 1;
    });
    return (
      <div className="cad-details">
        <h4>Part</h4>
        <div className="cad-title">{part.name}</div>
        {d ? (
          <KV
            rows={[
              ["Faces", `${d.faces.length.toLocaleString()}${d.faceSource === "brep" ? " (B-rep)" : d.faceSource === "mesh" ? " (from mesh)" : ""}`],
              ["Triangles", d.triangles.toLocaleString()],
              ["Bounding box", boxText(d.box, units)],
              ["Volume", d.closed ? units.vol(d.volume) : `${units.vol(d.volume)} (open mesh, approximate)`],
              ["Surface area", units.area(d.area)],
              ["Mass", `${mass(d.volume)} in ${mat.name}`],
              ["Features", Object.keys(counts).length ? Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 ? "s" : ""}`).join(", ") : "None recognized"],
            ]}
          />
        ) : (
          <p className="muted">Analyzing geometry…</p>
        )}
      </div>
    );
  }

  const f = featureOf(selection);
  if (!f) return null;
  const key = reviewKey(part.name, f.name);
  const status = reviews[key] ?? "Inferred";
  const rows: Row[] = [["Type", f.kind === "pattern" ? `${f.arrangement} pattern` : f.type]];
  if (f.kind === "hole") {
    rows.push(
      ["Diameter", units.dia(f.radius)],
      !!f.cbore && ["Counterbore", `${units.dia(f.cbore.radius)} × ${units.len(f.cbore.depth)} deep`],
      ["Depth", f.thru || f.depth == null ? "THRU ALL" : units.len(f.depth)],
      ["Axis", axisText(f.axis)],
      ["Removed volume", units.vol(f.volumeRemoved)],
      !!f.pattern && ["Pattern", link(`${f.pattern} (${f.patternCount}x)`, { kind: "feature", part: part.index, feature: f.pattern })],
    );
  } else if (f.kind === "pattern") {
    rows.push(["Instances", String(f.count)], [
      "Members",
      <span className="cad-links">
        {f.members.map((m) => (
          <span key={m}>{link(m, { kind: "feature", part: part.index, feature: m })}</span>
        ))}
      </span>,
    ]);
  } else if (f.kind === "fillet") {
    rows.push(["Radius", `R${units.len(f.radius)}`], ["Edges", String(f.edges)]);
  } else {
    rows.push(["Diameter", units.dia(f.radius)], ["Length", units.len(f.length)], ["Axis", axisText(f.axis)]);
  }
  rows.push(["Part", link(part.name, { kind: "part", part: part.index })], ["Faces", String(f.faceIds.length)]);

  return (
    <div className="cad-details">
      <h4>Feature</h4>
      <div className="cad-title">
        {f.name} <span className={`state ${STATUS_CLASS[status]}`}>{status}</span>
      </div>
      <KV rows={rows} />
      <div className="cad-prov">
        <h5>Provenance</h5>
        <KV
          rows={[
            ["Source", "CAD import (geometry recognition)"],
            "confidence" in f && [
              "Confidence",
              <span className="cad-conf">
                <b>{f.confidence}%</b>
                <i>
                  <i style={{ width: `${f.confidence}%` }} />
                </i>
              </span>,
            ],
            ["Evidence", f.evidence],
          ]}
        />
        <div className="cad-review">
          {status !== "Validated" ? (
            <button type="button" className="action" onClick={() => onReview(key, "Validated")}>
              <Check size={14} /> Validate
            </button>
          ) : null}
          {status !== "Rejected" ? (
            <button type="button" className="action" onClick={() => onReview(key, "Rejected")}>
              <X size={14} /> Reject
            </button>
          ) : null}
          {status !== "Inferred" ? (
            <button type="button" className="action" onClick={() => onReview(key, "Inferred")}>
              Return to inferred
            </button>
          ) : null}
        </div>
      </div>
      {requirements ? <RequirementLinks featureKey={key} requirements={requirements} links={links} onLink={onLink} /> : null}
      <FeatureHistory entries={historyFor(session, key)} />
    </div>
  );
}

function linkSummary(links: LinkMap): string {
  const features = Object.keys(links).length;
  if (!features) return "No features linked to requirements";
  const reqs = new Set(Object.values(links).flat()).size;
  return `${features} feature${features === 1 ? "" : "s"} linked to ${reqs} requirement${reqs === 1 ? "" : "s"}`;
}

const REQ_CLASS = (status: string) => (status === "Validated" ? "ok" : status === "Unresolved" ? "gap" : "review");

/** Requirements this feature traces to. Linking records traceability; it changes no status. */
function RequirementLinks({
  featureKey,
  requirements,
  links,
  onLink,
}: {
  featureKey: string;
  requirements: readonly LinkableRequirement[];
  links: LinkMap;
  onLink: (featureKey: string, requirement: string, add: boolean) => void;
}) {
  const linked = links[featureKey] ?? [];
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const available = requirements.filter((r) => !linked.includes(r.id));
  return (
    <div className="cad-prov cad-reqs">
      <h5>
        <Link2 size={13} /> Requirements
      </h5>
      {linked.length ? (
        <ul className="cad-reqlist">
          {linked.map((id) => {
            const r = byId.get(id);
            return (
              <li key={id}>
                <span>
                  <b>{id}</b> {r ? `${r.name} · ${r.value}` : "(no longer in the baseline)"}
                </span>
                {r ? <span className={`state ${REQ_CLASS(r.status)}`}>{r.status}</span> : null}
                <button type="button" className="cad-unlink" aria-label={`Unlink ${id}`} title={`Unlink ${id}`} onClick={() => onLink(featureKey, id, false)}>
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted cad-note">Not linked to a requirement yet.</p>
      )}
      {available.length ? (
        <label className="cad-field">
          <span>Link to requirement</span>
          <select
            value=""
            aria-label="Link to requirement"
            onChange={(e) => {
              if (e.target.value) onLink(featureKey, e.target.value, true);
            }}
          >
            <option value="">Choose a requirement…</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · {r.name} ({r.value})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="muted cad-note">Linking records traceability only. It doesn't change this feature's review or the requirement's status.</p>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function describe(e: HistoryEntry): string {
  if (e.kind === "review") return e.to === "Inferred" ? "Returned to inferred" : e.to;
  return `${e.kind === "link" ? "Linked" : "Unlinked"} ${e.requirement}`;
}

/** Most recent engineer actions on this feature, newest first. */
function FeatureHistory({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) return null;
  const recent = entries.slice(-6).reverse();
  return (
    <div className="cad-prov cad-history">
      <h5>History</h5>
      <ol>
        {recent.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span>{describe(e)}</span>
            <time dateTime={e.at}>
              {when(e.at)}
              {e.by ? ` · ${e.by}` : ""}
            </time>
          </li>
        ))}
      </ol>
      {entries.length > recent.length ? <p className="muted cad-note">{entries.length - recent.length} earlier entries kept.</p> : null}
    </div>
  );
}
