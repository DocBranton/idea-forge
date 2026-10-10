#!/usr/bin/env node
// Evidence manifest (AU-9, AU-11, CA-7). Hashes every file the pipeline produced,
// records the commit and pipeline, and maps each file to the NIST SP 800-53 Rev. 5
// controls it supports. The manifest is what an assessor starts from: every hash can
// be checked against the copy in write-once storage.
// Usage: node ci/evidence-manifest.mjs reports > reports/evidence-manifest.json
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Keep in step with docs/07-gitlab-il5-pipeline.md › Control map.
const CONTROL_MAP = [
  { match: /^test-.*\.log$/, kind: "Unit and integration test results", controls: ["SA-11", "CM-2"] },
  { match: /^sbom\.cdx\.json$/, kind: "Software bill of materials (CycloneDX)", controls: ["CM-8", "SR-4", "SA-8"] },
  { match: /^semgrep\.json$/, kind: "Static analysis (SAST) report", controls: ["SA-11(1)", "RA-5", "SI-2"] },
  { match: /^gitleaks\.json$/, kind: "Secrets scan report", controls: ["IA-5(7)", "SA-11", "RA-5"] },
  { match: /^npm-audit\.json$/, kind: "Dependency vulnerability report", controls: ["RA-5", "SI-2", "SR-3"] },
  { match: /^zap\.(json|html)$/, kind: "Dynamic analysis (DAST) report", controls: ["SA-11(8)", "RA-5", "CA-2"] },
  { match: /^dast-app\.log$/, kind: "Application log during DAST", controls: ["SA-11(8)"] },
  { match: /^provenance\.json(\.sig)?$/, kind: "Build provenance and signature", controls: ["SI-7", "SR-4", "SR-11"] },
  { match: /\.tar\.gz\.sig$/, kind: "Release artifact signature", controls: ["SI-7", "CM-14"] },
  { match: /^gate-decision\.json$/, kind: "Security gate decision", controls: ["CM-4", "CA-7", "SA-11"] },
  { match: /^poam-candidates\.json$/, kind: "Open findings for POA&M", controls: ["CA-5", "RA-7", "PM-4"] },
  { match: /^deploy-.*\.json$/, kind: "Deployment record", controls: ["CM-3", "CM-5", "AC-6", "IA-5"] },
];

const dir = process.argv[2] ?? "reports";
const files = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name !== "evidence-manifest.json") files.push(p);
  }
})(dir);

const env = process.env;
const entries = files.sort().map((p) => {
  const name = relative(dir, p);
  const rule = CONTROL_MAP.find((r) => r.match.test(name.split("/").pop()));
  return {
    file: name,
    sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
    bytes: statSync(p).size,
    kind: rule?.kind ?? "Unclassified",
    controls: rule?.controls ?? [],
  };
});

const byControl = {};
for (const e of entries) for (const c of e.controls) (byControl[c] ??= []).push(e.file);

process.stdout.write(JSON.stringify({
  system: "Idea Forge",
  framework: "NIST SP 800-53 Rev. 5",
  project: env.CI_PROJECT_PATH ?? null,
  commit: env.CI_COMMIT_SHA ?? null,
  ref: env.CI_COMMIT_REF_NAME ?? null,
  pipeline_id: env.CI_PIPELINE_ID ?? null,
  pipeline_url: env.CI_PIPELINE_URL ?? null,
  pipeline_source: env.CI_PIPELINE_SOURCE ?? null,
  generated_at: new Date().toISOString(),
  files: entries,
  controls: Object.fromEntries(Object.entries(byControl).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))),
}, null, 2) + "\n");
