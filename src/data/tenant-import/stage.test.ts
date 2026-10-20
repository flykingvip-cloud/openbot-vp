import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdRemapPlan, type IdRemapPlan } from "./id-remap.js";
import { buildTenantImportPackage } from "./package.js";
import { rewritePackagePath, stageTenantImportPackage } from "./stage.js";

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

// Plan: user u-src -> u-new (no email match), agent "main" collides with an existing target agent
// -> "main-imported".
function makePlan(): IdRemapPlan {
  return buildIdRemapPlan({
    targetTenantId: "acme",
    users: [{ sourceUserId: "u-src" }],
    agentIds: ["main"],
    existingAgentIds: ["main"],
    newId: () => "u-new",
  });
}

describe("rewritePackagePath", () => {
  const plan = makePlan();

  it("rewrites the user id and a colliding user-space agent id", () => {
    expect(rewritePackagePath("users/u-src/OpenBot/agents/main/workspace/n.md", plan)).toBe(
      "users/u-new/OpenBot/agents/main-imported/workspace/n.md",
    );
  });

  it("leaves control-plane and tenant-shared paths unchanged", () => {
    expect(rewritePackagePath("control-plane/seat-assets.json", plan)).toBe(
      "control-plane/seat-assets.json",
    );
    expect(rewritePackagePath("tenant-shared/knowledge/doc.md", plan)).toBe(
      "tenant-shared/knowledge/doc.md",
    );
  });

  it("leaves an unknown user id unchanged", () => {
    expect(rewritePackagePath("users/other/OpenBot/x.md", plan)).toBe("users/other/OpenBot/x.md");
  });
});

describe("stageTenantImportPackage", () => {
  let scratch = "";
  let controlPlane = "";
  let userDir = "";
  let staging = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-stage-"));
    controlPlane = path.join(scratch, "control-plane");
    userDir = path.join(scratch, "u-src-OpenBot");
    staging = path.join(scratch, "staging");
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

  it("extracts into staging with user/agent id path rewrites (§10.3)", async () => {
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

    const result = await stageTenantImportPackage({
      buffer,
      plan: makePlan(),
      stagingRoot: staging,
    });

    // Remapped user + agent path lands in staging.
    const remapped = path.join(
      staging,
      "users/u-new/OpenBot/agents/main-imported/workspace/note.md",
    );
    await expect(fs.readFile(remapped, "utf-8")).resolves.toBe("hello");
    // control-plane path preserved.
    await expect(
      fs.access(path.join(staging, "control-plane/seat-assets.json")),
    ).resolves.toBeUndefined();
    // Manifest kept for audit.
    await expect(
      fs.access(path.join(staging, "tenant-import-manifest.json")),
    ).resolves.toBeUndefined();
    // Rewrites recorded, original source path not present.
    expect(result.rewrites["users/u-src/OpenBot/agents/main/workspace/note.md"]).toBe(
      "users/u-new/OpenBot/agents/main-imported/workspace/note.md",
    );
    await expect(
      fs.access(path.join(staging, "users/u-src/OpenBot/agents/main/workspace/note.md")),
    ).rejects.toThrow();
  });
});
