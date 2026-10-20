import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitStagedTenantImport, verifyStagedTenantImport } from "./commit.js";
import { buildIdRemapPlan } from "./id-remap.js";
import { TENANT_IMPORT_MANIFEST_NAME } from "./manifest.js";
import { buildTenantImportPackage } from "./package.js";
import { stageTenantImportPackage } from "./stage.js";

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

describe("verifyStagedTenantImport", () => {
  let staging = "";
  beforeEach(async () => {
    staging = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-verify-"));
  });
  afterEach(async () => {
    await fs.rm(staging, { recursive: true, force: true });
  });

  it("passes a clean staged tree", async () => {
    await fs.writeFile(path.join(staging, TENANT_IMPORT_MANIFEST_NAME), "{}");
    await fs.mkdir(path.join(staging, "control-plane"), { recursive: true });
    await fs.writeFile(path.join(staging, "control-plane", "seat-assets.json"), '{"seats":[]}');
    const result = await verifyStagedTenantImport(staging);
    expect(result.ok).toBe(true);
  });

  it("fails when a config file retains a source-machine absolute path (§10.3)", async () => {
    await fs.writeFile(path.join(staging, TENANT_IMPORT_MANIFEST_NAME), "{}");
    await fs.mkdir(path.join(staging, "users", "u1", "OpenBot"), { recursive: true });
    await fs.writeFile(
      path.join(staging, "users", "u1", "OpenBot", "config.json"),
      '{"workspace":"/Users/daniel/ws-bot-2"}',
    );
    const result = await verifyStagedTenantImport(staging);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("config.json"))).toBe(true);
  });

  it("fails when the manifest is missing", async () => {
    const result = await verifyStagedTenantImport(staging);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(TENANT_IMPORT_MANIFEST_NAME))).toBe(true);
  });
});

describe("commitStagedTenantImport (full pipeline)", () => {
  let scratch = "";
  let controlPlane = "";
  let userDir = "";
  let staging = "";
  let liveRoot = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-commit-"));
    controlPlane = path.join(scratch, "control-plane");
    userDir = path.join(scratch, "u-src-OpenBot");
    staging = path.join(scratch, "staging");
    liveRoot = path.join(scratch, "tenants", "acme");
    await fs.mkdir(controlPlane, { recursive: true });
    await fs.writeFile(path.join(controlPlane, "seat-assets.json"), '{"seats":[]}');
    await fs.mkdir(path.join(userDir, "agents", "main", "workspace"), { recursive: true });
    await fs.writeFile(path.join(userDir, "agents", "main", "workspace", "note.md"), "hello");
    await fs.mkdir(path.join(userDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(userDir, ".meta", "manifest.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("packages, stages, verifies, and commits into the live tenant tree idempotently", async () => {
    const { buffer } = await buildTenantImportPackage(
      {
        environment: "local-dev",
        sourceTenantId: "src",
        targetTenantId: "acme",
        userDataSpaces: { "u-src": userDir },
        controlPlaneDir: controlPlane,
      },
      { now: fixedNow },
    );
    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [{ sourceUserId: "u-src" }],
      agentIds: ["main"],
      newId: () => "u-new",
    });

    await stageTenantImportPackage({ buffer, plan, stagingRoot: staging });
    const verify = await verifyStagedTenantImport(staging);
    expect(verify.ok).toBe(true);

    const commit = await commitStagedTenantImport({
      stagedRoot: staging,
      tenantLiveRoot: liveRoot,
    });
    expect(commit.committedFiles).toBe(3); // seat-assets + note.md + .meta/manifest.json

    await expect(
      fs.readFile(
        path.join(liveRoot, "users/u-new/OpenBot/agents/main/workspace/note.md"),
        "utf-8",
      ),
    ).resolves.toBe("hello");
    await expect(
      fs.access(path.join(liveRoot, "control-plane/seat-assets.json")),
    ).resolves.toBeUndefined();
    // Import metadata must not be merged into tenant content.
    await expect(fs.access(path.join(liveRoot, TENANT_IMPORT_MANIFEST_NAME))).rejects.toThrow();

    // Idempotent re-commit: same file count, content stable.
    const recommit = await commitStagedTenantImport({
      stagedRoot: staging,
      tenantLiveRoot: liveRoot,
    });
    expect(recommit.committedFiles).toBe(3);
  });
});
