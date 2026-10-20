import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTenantImportPackage, TenantImportSecretError } from "./package.js";
import { preflightTenantImportArchive } from "./preflight.js";

const fixedNow = () => new Date("2026-07-11T06:10:35.756Z");

describe("buildTenantImportPackage", () => {
  let scratch = "";
  let controlPlane = "";
  let userDir = "";
  let tenantShared = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ti-"));
    controlPlane = path.join(scratch, "control-plane");
    userDir = path.join(scratch, "u1-OpenBot");
    tenantShared = path.join(scratch, "tenant-shared");
    await fs.mkdir(controlPlane, { recursive: true });
    await fs.writeFile(path.join(controlPlane, "seat-assets.json"), '{"seats":[]}');
    await fs.mkdir(path.join(userDir, "agents", "main", "workspace"), { recursive: true });
    await fs.writeFile(path.join(userDir, "agents", "main", "workspace", "note.md"), "hello");
    await fs.mkdir(path.join(userDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(userDir, ".meta", "manifest.json"), "{}");
    await fs.mkdir(path.join(tenantShared, "knowledge"), { recursive: true });
    await fs.writeFile(path.join(tenantShared, "knowledge", "doc.md"), "kb");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  function baseSource() {
    return {
      environment: "local-dev",
      sourceTenantId: "tenant-acme-local",
      targetTenantId: "acme",
      userDataSpaces: { "u-local-1": userDir },
      controlPlaneDir: controlPlane,
      tenantSharedDir: tenantShared,
    };
  }

  it("packages control-plane, per-user L2, and tenant-shared into a manifest-stamped zip", async () => {
    const result = await buildTenantImportPackage(baseSource(), { now: fixedNow });
    expect(result.manifest.target.targetTenantId).toBe("acme");
    expect(result.manifest.contents.userDataSpaces).toEqual(["u-local-1"]);
    expect(result.manifest.contents.controlPlane).toBe(true);
    expect(result.manifest.contents.tenantShared).toBe(true);
    expect(result.manifest.stats.userCount).toBe(1);
    expect(result.manifest.stats.agentCount).toBe(1);
    // seat-assets.json + note.md + .meta/manifest.json + tenant-shared/knowledge/doc.md
    expect(result.manifest.stats.fileCount).toBe(4);

    const zip = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain("tenant-import-manifest.json");
    expect(names).toContain("control-plane/seat-assets.json");
    expect(names).toContain("users/u-local-1/OpenBot/agents/main/workspace/note.md");
    expect(names).toContain("tenant-shared/knowledge/doc.md");
  });

  it("produces a package that passes preflight for the matching tenant (round-trip)", async () => {
    const result = await buildTenantImportPackage(baseSource(), { now: fixedNow });
    const preflight = await preflightTenantImportArchive({
      buffer: result.buffer,
      jobTargetTenantId: "acme",
    });
    expect(preflight.ok).toBe(true);
    expect(preflight.manifest?.source.sourceTenantId).toBe("tenant-acme-local");
  });

  it("excludes rebuildable cache/ from per-user data spaces", async () => {
    await fs.mkdir(path.join(userDir, "cache"), { recursive: true });
    await fs.writeFile(path.join(userDir, "cache", "big.bin"), "x".repeat(100));
    const result = await buildTenantImportPackage(baseSource(), { now: fixedNow });
    const zip = await JSZip.loadAsync(result.buffer);
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.includes("/cache/"))).toBe(false);
  });

  it("aborts packaging when a control-plane file leaks a plaintext secret (§9.2)", async () => {
    await fs.writeFile(
      path.join(controlPlane, "enterprise-data.json"),
      '{"connector":{"botToken":"leaked-123"}}',
    );
    await expect(buildTenantImportPackage(baseSource(), { now: fixedNow })).rejects.toBeInstanceOf(
      TenantImportSecretError,
    );
  });

  it("aborts packaging when a forbidden credentials path is present (§9.2)", async () => {
    await fs.mkdir(path.join(controlPlane, "credentials"), { recursive: true });
    await fs.writeFile(path.join(controlPlane, "credentials", "openai.txt"), "sk-live");
    await expect(buildTenantImportPackage(baseSource(), { now: fixedNow })).rejects.toBeInstanceOf(
      TenantImportSecretError,
    );
  });
});
