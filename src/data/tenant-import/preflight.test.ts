import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildTenantImportManifest, TENANT_IMPORT_MANIFEST_NAME } from "./manifest.js";
import { isUnsafeEntryName, preflightTenantImportArchive } from "./preflight.js";

async function makeZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function validManifestJson(targetTenantId = "acme"): string {
  return JSON.stringify(
    buildTenantImportManifest({
      environment: "local-dev",
      sourceTenantId: "src",
      targetTenantId,
      userDataSpaces: ["u1"],
    }),
  );
}

describe("isUnsafeEntryName", () => {
  it("flags absolute and traversal entry names", () => {
    expect(isUnsafeEntryName("../escapee.txt")).toBe(true);
    expect(isUnsafeEntryName("/etc/passwd")).toBe(true);
    expect(isUnsafeEntryName("C:/Windows/x")).toBe(true);
    expect(isUnsafeEntryName("a/../../b")).toBe(true);
  });

  it("accepts normal package-relative names", () => {
    expect(isUnsafeEntryName("users/u1/OpenBot/agents/main/note.md")).toBe(false);
    expect(isUnsafeEntryName("control-plane/seat-assets.json")).toBe(false);
    expect(isUnsafeEntryName("a/b/../c")).toBe(false); // normalizes to a/c
  });
});

describe("preflightTenantImportArchive", () => {
  it("accepts a valid, secret-free package for the matching tenant", async () => {
    const buffer = await makeZip({
      [TENANT_IMPORT_MANIFEST_NAME]: validManifestJson("acme"),
      "control-plane/seat-assets.json": '{"seats":[]}',
      "users/u1/OpenBot/agents/main/workspace/note.md": "hello",
    });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(true);
    expect(result.manifest?.target.targetTenantId).toBe("acme");
    // manifest + seat-assets.json + note.md
    expect(result.stats.entryCount).toBe(3);
  });

  it("rejects a cross-tenant package (§4.1)", async () => {
    const buffer = await makeZip({ [TENANT_IMPORT_MANIFEST_NAME]: validManifestJson("acme") });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "globex" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("不一致"))).toBe(true);
  });

  it("rejects a package without a manifest", async () => {
    const buffer = await makeZip({ "users/u1/OpenBot/note.md": "hi" });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(TENANT_IMPORT_MANIFEST_NAME))).toBe(true);
  });

  it("rejects a package carrying a credentials path", async () => {
    const buffer = await makeZip({
      [TENANT_IMPORT_MANIFEST_NAME]: validManifestJson("acme"),
      "control-plane/credentials/openai.json": '{"apiKey":"sk-live"}',
    });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(false);
    expect(result.secretFindings.length).toBeGreaterThan(0);
  });

  it("rejects a package with a plaintext secret field in JSON", async () => {
    const buffer = await makeZip({
      [TENANT_IMPORT_MANIFEST_NAME]: validManifestJson("acme"),
      "control-plane/seat-assets.json": '{"botToken":"abc123"}',
    });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(false);
    expect(result.secretFindings.some((f) => f.rule === "content:botToken")).toBe(true);
  });

  it("rejects a config that retains a source-machine absolute path (§10.3)", async () => {
    const buffer = await makeZip({
      [TENANT_IMPORT_MANIFEST_NAME]: validManifestJson("acme"),
      "users/u1/OpenBot/agents/main/config.json": '{"workspace":"/Users/daniel/ws-bot-2"}',
    });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("config.json") && e.includes("绝对路径"))).toBe(
      true,
    );
  });

  it("rejects a source-machine absolute path in a non-JSON config (yaml)", async () => {
    const buffer = await makeZip({
      [TENANT_IMPORT_MANIFEST_NAME]: validManifestJson("acme"),
      "users/u1/OpenBot/agents/main/config.yaml": "workspace: /home/alice/ws-bot-2\n",
    });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("config.yaml") && e.includes("绝对路径"))).toBe(
      true,
    );
  });

  it("does not flag the manifest's own source path hints", async () => {
    const manifest = JSON.stringify(
      buildTenantImportManifest({
        environment: "local-dev",
        sourceTenantId: "src",
        targetTenantId: "acme",
        userDataSpaces: ["u1"],
        sourceDataRootHint: "/Users/daniel/OpenBot",
        sourceStateDirHint: "/Users/daniel/.openbot",
      }),
    );
    const buffer = await makeZip({
      [TENANT_IMPORT_MANIFEST_NAME]: manifest,
      "users/u1/OpenBot/agents/main/note.md": "hello",
    });
    const result = await preflightTenantImportArchive({ buffer, jobTargetTenantId: "acme" });
    expect(result.ok).toBe(true);
  });
});
