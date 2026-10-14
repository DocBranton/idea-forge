#!/usr/bin/env node
// Build provenance for the release tarball (SI-7, SR-4). In-toto / SLSA v1 shaped
// statement: what was built, from which commit, by which pipeline, with which inputs.
// Usage: node ci/provenance.mjs release/idea-forge-<sha>.tar.gz > release/provenance.json
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const artifact = process.argv[2];
if (!artifact || !existsSync(artifact)) throw new Error("usage: provenance.mjs <artifact>");
const env = process.env;
const material = (path) => (existsSync(path) ? [{ uri: path, digest: { sha256: sha256(path) } }] : []);

const statement = {
  _type: "https://in-toto.io/Statement/v1",
  subject: [{ name: basename(artifact), digest: { sha256: sha256(artifact) } }],
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://gitlab.com/idea-forge/release-tarball@v1",
      externalParameters: { repository: env.CI_PROJECT_URL ?? null, ref: env.CI_COMMIT_REF_NAME ?? null },
      internalParameters: { pipeline_source: env.CI_PIPELINE_SOURCE ?? null },
      resolvedDependencies: [
        { uri: `git+${env.CI_PROJECT_URL ?? "local"}@${env.CI_COMMIT_REF_NAME ?? "HEAD"}`, digest: { gitCommit: env.CI_COMMIT_SHA ?? null } },
        ...material("package-lock.json"),
        ...material("reports/sbom.cdx.json"),
      ],
    },
    runDetails: {
      builder: { id: env.CI_SERVER_URL ? `${env.CI_SERVER_URL}/runner/${env.CI_RUNNER_ID ?? "unknown"}` : "local" },
      metadata: {
        invocationId: env.CI_PIPELINE_URL ?? null,
        startedOn: env.CI_PIPELINE_CREATED_AT ?? null,
        finishedOn: new Date().toISOString(),
        triggeredBy: env.GITLAB_USER_LOGIN ?? null,
      },
    },
  },
};
process.stdout.write(JSON.stringify(statement, null, 2) + "\n");
