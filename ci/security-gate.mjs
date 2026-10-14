#!/usr/bin/env node
// Security gate. Reads every scanner report in reports/, normalizes findings, applies
// documented risk acceptances, and fails the pipeline when an unaccepted finding is
// at or above --fail-on. Writes two evidence files:
//   reports/gate-decision.json   what was found, what was accepted, pass/fail (CM-4, CA-7)
//   reports/poam-candidates.json open findings that need a POA&M entry (CA-5)
//
// Usage: node ci/security-gate.mjs --reports reports --acceptances security/risk-acceptances.json --fail-on high
// --fail-on: critical | high | medium | low | none
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RANK = { none: 99, critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const DEFAULT_LICENSE_DENYLIST = ["AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later", "SSPL-1.0"];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const reportsDir = arg("reports", "reports");
const acceptancesPath = arg("acceptances", "security/risk-acceptances.json");
const failOn = arg("fail-on", "high").toLowerCase();
if (!(failOn in RANK)) throw new Error(`--fail-on must be one of ${Object.keys(RANK).join(", ")}`);
const denylist = (process.env.LICENSE_DENYLIST?.split(",").map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_LICENSE_DENYLIST;

/** A required report that is missing is itself a blocking finding: the gate fails closed. */
const findings = [];
const sources = {};

function load(file, required) {
  const path = join(reportsDir, file);
  if (!existsSync(path)) {
    sources[file] = "missing";
    if (required) findings.push({ id: `missing:${file}`, tool: "gate", severity: "critical", title: `Required report ${file} was not produced`, location: path });
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    sources[file] = "read";
    return data;
  } catch (e) {
    sources[file] = "unreadable";
    findings.push({ id: `unreadable:${file}`, tool: "gate", severity: "critical", title: `Report ${file} could not be parsed: ${e.message}`, location: path });
    return null;
  }
}

// Semgrep (SAST)
const semgrep = load("semgrep.json", true);
for (const r of semgrep?.results ?? []) {
  const sev = { ERROR: "high", WARNING: "medium", INFO: "low" }[r.extra?.severity] ?? "medium";
  findings.push({ id: `semgrep:${r.check_id}:${r.path}:${r.start?.line}`, tool: "semgrep", severity: sev, title: r.extra?.message?.split("\n")[0] ?? r.check_id, location: `${r.path}:${r.start?.line}` });
}
for (const e of semgrep?.errors ?? []) {
  if (e.level === "error") findings.push({ id: `semgrep-error:${e.type}`, tool: "semgrep", severity: "high", title: `Semgrep error: ${e.message ?? e.type}`, location: e.path ?? "" });
}

// Gitleaks (secrets). Any live secret blocks.
const gitleaks = load("gitleaks.json", true);
for (const g of Array.isArray(gitleaks) ? gitleaks : []) {
  findings.push({ id: `gitleaks:${g.Fingerprint ?? `${g.File}:${g.RuleID}:${g.StartLine}`}`, tool: "gitleaks", severity: "critical", title: `Possible secret (${g.RuleID})`, location: `${g.File}:${g.StartLine}` });
}

// npm audit (dependencies)
const audit = load("npm-audit.json", true);
for (const [name, v] of Object.entries(audit?.vulnerabilities ?? {})) {
  const advisories = (v.via ?? []).filter((x) => typeof x === "object");
  if (!advisories.length) continue; // transitive-only entries are reported under their source package
  for (const a of advisories) {
    const ghsa = a.url?.split("/").pop() ?? String(a.source);
    const sev = a.severity === "moderate" ? "medium" : (a.severity ?? v.severity);
    findings.push({ id: `npm:${name}:${ghsa}`, tool: "npm-audit", severity: sev, title: `${name}: ${a.title}`, location: `package-lock.json (${a.range ?? v.range ?? "?"})`, fix: v.fixAvailable ? "upgrade available" : "no fix yet" });
  }
}

// OWASP ZAP (DAST)
const zap = load("zap.json", true);
for (const site of zap?.site ?? []) {
  for (const a of site.alerts ?? []) {
    const sev = { 3: "high", 2: "medium", 1: "low", 0: "info" }[Number(a.riskcode)] ?? "medium";
    findings.push({ id: `zap:${a.pluginid}`, tool: "zap", severity: sev, title: a.name ?? a.alert, location: `${site["@name"]} (${a.count ?? a.instances?.length ?? 0} instances)` });
  }
}

// SBOM license policy
const sbom = load("sbom.cdx.json", true);
for (const c of sbom?.components ?? []) {
  const ids = (c.licenses ?? []).map((l) => l.license?.id ?? l.license?.name ?? l.expression).filter(Boolean);
  const hit = ids.find((id) => denylist.some((d) => id === d || id.split(/\s+(?:OR|AND|WITH)\s+|[()]/).includes(d)));
  if (hit) findings.push({ id: `license:${c.name}`, tool: "license", severity: "high", title: `${c.name}@${c.version} is licensed ${hit}`, location: c.purl ?? c.name });
}

// Risk acceptances. Each needs an approver, a POA&M reference and an expiry date.
let acceptances = [];
if (existsSync(acceptancesPath)) acceptances = JSON.parse(readFileSync(acceptancesPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const problems = [];
const live = new Map();
for (const a of acceptances) {
  const missing = ["id", "reason", "approver", "poam", "expires"].filter((k) => !a[k]);
  if (missing.length) problems.push(`Acceptance ${a.id ?? "(no id)"} is missing ${missing.join(", ")}; ignored.`);
  else if (a.expires < today) problems.push(`Acceptance ${a.id} expired on ${a.expires}; ignored.`);
  else live.set(a.id, a);
}

const matched = (f) => live.get(f.id) ?? [...live.values()].find((a) => a.id.endsWith("*") && f.id.startsWith(a.id.slice(0, -1)));
const rows = findings.map((f) => ({ ...f, accepted: matched(f) ?? null }));
const blocking = rows.filter((f) => !f.accepted && RANK[f.severity] >= RANK[failOn]);
const open = rows.filter((f) => RANK[f.severity] >= RANK.medium);
const count = (list) => Object.fromEntries(["critical", "high", "medium", "low", "info"].map((s) => [s, list.filter((f) => f.severity === s).length]));

const decision = {
  result: blocking.length ? "fail" : "pass",
  fail_on: failOn,
  commit: process.env.CI_COMMIT_SHA ?? null,
  pipeline: process.env.CI_PIPELINE_URL ?? null,
  ref: process.env.CI_COMMIT_REF_NAME ?? null,
  decided_at: new Date().toISOString(),
  sources,
  totals: count(rows),
  blocking: blocking.map(({ accepted, ...f }) => f),
  accepted: rows.filter((f) => f.accepted).map((f) => ({ id: f.id, severity: f.severity, approver: f.accepted.approver, poam: f.accepted.poam, expires: f.accepted.expires })),
  acceptance_problems: problems,
};
const poam = open.map((f) => ({
  finding: f.id, tool: f.tool, severity: f.severity, title: f.title, location: f.location,
  status: f.accepted ? "risk accepted" : "open", poam: f.accepted?.poam ?? null, approver: f.accepted?.approver ?? null, expires: f.accepted?.expires ?? null,
  first_seen_commit: process.env.CI_COMMIT_SHA ?? null,
}));

writeFileSync(join(reportsDir, "gate-decision.json"), JSON.stringify(decision, null, 2) + "\n");
writeFileSync(join(reportsDir, "poam-candidates.json"), JSON.stringify(poam, null, 2) + "\n");

const t = decision.totals;
console.log(`Security gate: ${decision.result.toUpperCase()} (fail on ${failOn} and above)`);
console.log(`Findings: ${t.critical} critical, ${t.high} high, ${t.medium} medium, ${t.low} low, ${t.info} info. Accepted: ${decision.accepted.length}.`);
for (const p of problems) console.log(`Warning: ${p}`);
for (const f of blocking) console.log(`BLOCKING [${f.severity}] ${f.tool}: ${f.title} — ${f.location}  (id: ${f.id})`);
process.exit(blocking.length ? 1 : 0);
