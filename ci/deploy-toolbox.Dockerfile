# Deploy toolbox for the GitLab pipeline: Databricks CLI, cosign, AWS CLI, Node, git, jq.
# Build once, scan it, push to the project registry as deploy-toolbox:<n>, and set
# TOOLBOX_IMAGE to its digest. For IL5, set BASE to an Iron Bank image and mirror the
# downloads below into an internal artifact store.
#   docker build -f ci/deploy-toolbox.Dockerfile -t $CI_REGISTRY_IMAGE/deploy-toolbox:1 .
ARG BASE=node:22-bookworm-slim
FROM ${BASE}

ARG DATABRICKS_CLI_VERSION=0.229.0
ARG COSIGN_VERSION=2.4.1
ARG TARGETARCH=amd64

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git jq unzip tar \
 && rm -rf /var/lib/apt/lists/*

# Databricks CLI (pinned release from github.com/databricks/cli)
RUN curl -fsSL -o /tmp/dbx.zip "https://github.com/databricks/cli/releases/download/v${DATABRICKS_CLI_VERSION}/databricks_cli_${DATABRICKS_CLI_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/dbx.zip -d /usr/local/bin databricks && rm /tmp/dbx.zip \
 && databricks --version

# cosign (pinned release from github.com/sigstore/cosign)
RUN curl -fsSL -o /usr/local/bin/cosign "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-${TARGETARCH}" \
 && chmod +x /usr/local/bin/cosign && cosign version

# AWS CLI v2, for copying evidence to the Object Lock bucket (GovCloud)
RUN curl -fsSL -o /tmp/aws.zip "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" \
 && unzip -q /tmp/aws.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/aws.zip \
 && aws --version

