import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dockerfilePath = join(repoRoot, "Dockerfile");

describe("Dockerfile", () => {
  it("uses shared multi-arch base image refs for all root Node stages", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain(
      'ARG OPENCLAW_NODE_BOOKWORM_IMAGE="node:22-bookworm@sha256:b501c082306a4f528bc4038cbf2fbb58095d583d0419a259b2114b5ac53d12e9"',
    );
    expect(dockerfile).toContain(
      'ARG OPENCLAW_NODE_BOOKWORM_SLIM_IMAGE="node:22-bookworm-slim@sha256:9c2c405e3ff9b9afb2873232d24bb06367d649aa3e6259cbe314da59578e81e9"',
    );
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS ext-deps");
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS build");
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS base-default");
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_SLIM_IMAGE} AS base-slim");
    expect(dockerfile).toContain("current multi-arch manifest list entry");
    expect(dockerfile).not.toContain("current amd64 entry");
  });

  it("always installs diagnostics-otel and matrix before optional extensions", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const loop = dockerfile.slice(
      dockerfile.indexOf("for ext in "),
      dockerfile.indexOf("; do", dockerfile.indexOf("for ext in ")),
    );
    expect(loop).toContain("diagnostics-otel matrix $OPENCLAW_EXTENSIONS");
  });

  it("installs optional browser dependencies after pnpm install", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const installIndex = dockerfile.indexOf("pnpm install --frozen-lockfile");
    const browserArgIndex = dockerfile.indexOf("ARG OPENCLAW_INSTALL_BROWSER");

    expect(installIndex).toBeGreaterThan(-1);
    expect(browserArgIndex).toBeGreaterThan(-1);
    expect(browserArgIndex).toBeGreaterThan(installIndex);
    expect(dockerfile).toContain(
      "node /app/node_modules/playwright-core/cli.js install --with-deps chromium",
    );
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends xvfb");
  });

  it("prunes runtime dependencies after the build stage", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("FROM build AS runtime-assets");
    expect(dockerfile).toContain("CI=true pnpm prune --prod");
    expect(dockerfile).toContain(
      "COPY --from=runtime-assets --chown=node:node /app/node_modules ./node_modules",
    );
  });

  it("normalizes plugin and agent paths permissions in image layers", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("for dir in /app/extensions /app/.agent /app/.agents");
    expect(dockerfile).toContain('find "$dir" -type d -exec chmod 755 {} +');
    expect(dockerfile).toContain('find "$dir" -type f -exec chmod 644 {} +');
  });

  it("Docker GPG fingerprint awk uses correct quoting for OPENCLAW_SANDBOX=1 build", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain('== "fpr" {');
    expect(dockerfile).not.toContain('\\"fpr\\"');
  });

  it("adds OPENBOT_SURFACE orthogonal to OPENCLAW_VARIANT, defaulting to full", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("ARG OPENCLAW_VARIANT=default");
    expect(dockerfile).toContain("FROM base-${OPENCLAW_VARIANT}");
    expect(dockerfile.match(/ARG OPENBOT_SURFACE=full/g)?.length).toBe(2);
    expect(dockerfile).toContain("full + default:");
    expect(dockerfile).toContain("full + slim:");
    const validation = dockerfile.indexOf('case "${OPENBOT_SURFACE}"');
    const imageBuild = dockerfile.indexOf("RUN pnpm build:docker");
    const uiBuild = dockerfile.indexOf("RUN pnpm ui:build");
    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(imageBuild);
    expect(imageBuild).toBeLessThan(uiBuild);
    expect(dockerfile).toContain('""|full)');
    expect(dockerfile).not.toContain("appliance");
    expect(dockerfile).not.toContain("customer-special");
    expect(dockerfile).toContain("ENV OPENBOT_SURFACE=${OPENBOT_SURFACE:-full}");
    const runtimeBase = dockerfile.indexOf("FROM base-${OPENCLAW_VARIANT}");
    const runtimeEnv = dockerfile.lastIndexOf("ENV OPENBOT_SURFACE=${OPENBOT_SURFACE:-full}");
    expect(runtimeEnv).toBeGreaterThan(runtimeBase);
    expect(dockerfile).toContain('openbot.surface="${OPENBOT_SURFACE:-full}"');
    expect(dockerfile).not.toContain("rm -rf ui/src/ui/ports/platform");
  });

  it("documents the docker CLI install for account-worker sockets", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("OPENBOT_ACCOUNT_WORKER_DOCKER=1");
    expect(dockerfile).toContain("ARG OPENCLAW_INSTALL_DOCKER_CLI");
  });

  it("keeps runtime pnpm available", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("ENV COREPACK_HOME=/usr/local/share/corepack");
    expect(dockerfile).toContain(
      'corepack prepare "$(node -p "require(\'./package.json\').packageManager")" --activate',
    );
  });
});
