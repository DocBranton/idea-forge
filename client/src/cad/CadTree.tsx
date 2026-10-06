import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Box, Boxes, ChevronRight, CircleDot, Eye, EyeOff, Grid2x2, Link2, Square } from "lucide-react";
import type { Feature, ModelData, ModelNode, ReviewStatus } from "./engine/types";
import type { Selection, ViewerPart } from "./engine/viewer";
import type { Units } from "./engine/units";
import { featureLabel, reviewKey } from "./labels";
import type { LinkMap } from "./links";

interface TreeNode {
  key: string;
  type: "assembly" | "part" | "feature";
  name: string;
  desc?: string;
  parts: number[];
  partIdx?: number;
  feature?: Feature;
  children: TreeNode[];
}

function buildTree(model: ModelData, parts: ViewerPart[], units: Units): TreeNode {
  let asm = 0;
  const partNode = (i: number): TreeNode => {
    const p = parts[i];
    const features = (p.data?.features ?? []).slice().sort((a, b) => {
      const order = { hole: 0, pattern: 1, fillet: 2, boss: 3 };
      return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name);
    });
    return {
      key: `part:${i}`,
      type: "part",
      name: p.name,
      parts: [i],
      partIdx: i,
      children: features.map((f) => ({ key: `feat:${i}:${f.name}`, type: "feature", name: f.name, desc: featureLabel(f, units), parts: [i], partIdx: i, feature: f, children: [] })),
    };
  };
  const collect = (n: TreeNode): number[] => (n.type === "part" ? n.parts : n.children.flatMap(collect));
  const build = (n: ModelNode, depth: number): TreeNode => {
    if (!n.children.length && n.meshes.length === 1 && depth > 0) return partNode(n.meshes[0]);
    const node: TreeNode = { key: `asm:${asm++}`, type: "assembly", name: n.name || "Assembly", parts: [], children: [...n.meshes.map(partNode), ...n.children.map((c) => build(c, depth + 1))] };
    node.parts = collect(node);
    return node;
  };
  const root = build(model.root, 0);
  return root.type === "assembly" ? root : { key: "asm:root", type: "assembly", name: model.name, parts: root.parts, children: [root] };
}

const STATUS_CLASS: Record<ReviewStatus, string> = { Inferred: "review", Validated: "ok", Rejected: "gap" };

export function CadTree({
  model,
  parts,
  units,
  selection,
  reviews,
  links,
  rev,
  onSelect,
  onFit,
  onVisibility,
}: {
  model: ModelData;
  parts: ViewerPart[];
  units: Units;
  selection: Selection | null;
  reviews: Readonly<Record<string, ReviewStatus>>;
  links?: LinkMap;
  rev: number;
  onSelect: (sel: Selection) => void;
  onFit: () => void;
  onVisibility: (parts: number[], show: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  // Assemblies start open; parts start collapsed so their features don't flood the tree.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (n: TreeNode) => (n.type === "assembly") !== toggled.has(n.key);
  // rev changes whenever analysis, visibility or units change.
  const root = useMemo(() => buildTree(model, parts, units), [model, parts, units, rev]);

  const selectedKey = !selection
    ? null
    : selection.kind === "feature"
      ? `feat:${selection.part}:${selection.feature}`
      : selection.kind === "assembly"
        ? selection.key
        : `part:${selection.part}`;

  // Reveal the selected feature's part.
  useEffect(() => {
    if (selection?.kind !== "feature") return;
    const key = `part:${selection.part}`;
    setToggled((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, [selection]);

  const q = query.trim().toLowerCase();
  const matches = (n: TreeNode): boolean => !q || `${n.name} ${n.desc ?? ""}`.toLowerCase().includes(q) || n.children.some(matches);

  const activate = (n: TreeNode) => {
    if (n.type === "part" && n.partIdx != null) onSelect({ kind: "part", part: n.partIdx });
    else if (n.type === "feature" && n.partIdx != null && n.feature) onSelect({ kind: "feature", part: n.partIdx, feature: n.feature.name });
    else onSelect({ kind: "assembly", parts: n.parts, key: n.key, name: n.name });
  };

  const rows: ReactElement[] = [];
  const walk = (n: TreeNode, depth: number) => {
    if (!matches(n)) return;
    const open = q ? true : isOpen(n);
    const hidden = n.parts.length > 0 && n.parts.every((i) => !parts[i]?.visible);
    const Icon = n.type === "assembly" ? Boxes : n.type === "part" ? Box : n.feature?.kind === "pattern" ? Grid2x2 : n.feature?.kind === "hole" ? CircleDot : Square;
    const fkey = n.feature && n.partIdx != null ? reviewKey(parts[n.partIdx].name, n.feature.name) : null;
    const status = fkey ? reviews[fkey] ?? "Inferred" : null;
    const linked = fkey ? links?.[fkey] ?? [] : [];
    rows.push(
      <div
        key={n.key}
        role="treeitem"
        aria-selected={selectedKey === n.key}
        aria-expanded={n.children.length ? open : undefined}
        tabIndex={0}
        className={`cad-row ${n.type}${selectedKey === n.key ? " on" : ""}${hidden ? " dim" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => activate(n)}
        onDoubleClick={() => {
          activate(n);
          onFit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate(n);
          }
        }}
      >
        {n.children.length ? (
          <button
            type="button"
            className={`cad-twisty${open ? " open" : ""}`}
            aria-label={open ? "Collapse" : "Expand"}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setToggled((s) => {
                const next = new Set(s);
                if (next.has(n.key)) next.delete(n.key);
                else next.add(n.key);
                return next;
              });
            }}
          >
            <ChevronRight size={12} />
          </button>
        ) : (
          <span className="cad-twisty" />
        )}
        <Icon size={14} className="cad-row-icon" />
        <span className="cad-row-name">{n.name}</span>
        {n.desc ? <span className="cad-row-desc">{n.desc}</span> : null}
        {linked.length ? (
          <span className="cad-linked" title={`Linked to ${linked.join(", ")}`}>
            <Link2 size={12} />
          </span>
        ) : null}
        {status && status !== "Inferred" ? <span className={`cad-dot ${STATUS_CLASS[status]}`} title={status} /> : null}
        {n.type !== "feature" ? (
          <button
            type="button"
            className="cad-vis"
            tabIndex={-1}
            title={hidden ? "Show" : "Hide"}
            onClick={(e) => {
              e.stopPropagation();
              onVisibility(n.parts, hidden);
            }}
          >
            {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : null}
      </div>,
    );
    if (open) n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);

  return (
    <div className="cad-tree">
      <input className="cad-search" type="search" placeholder="Search parts and features" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div role="tree" className="cad-tree-rows">
        {rows.length ? rows : <p className="muted cad-empty">No parts or features match.</p>}
      </div>
    </div>
  );
}
