import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_DRAFT_TTL_MS,
  writeGroupDeliverableManifest,
} from "../knowledge/deliverables/group-manifest.js";
import {
  createWorkspaceCutoverOperation,
  FileWorkspaceCutoverStore,
  transitionWorkspaceCutoverOperation,
} from "../workspace-cutover/index.js";
import { createEmptyWorkspaceCatalog } from "./catalog.js";
import {
  readGroupWorkspaceFileContent,
  readGroupWorkspaceManifestContent,
  listGroupWorkspaceRelativeDir,
  pruneGroupWorkspaceExpiredDrafts,
  upsertGroupWorkspaceDeliverableCanonical,
  upsertGroupWorkspaceDeliverableDraft,
  writeGroupWorkspaceRelativeFile,
} from "./group-read.js";

describe("group workspace resolver integration", () => {
  it("reads group deliverable through resolver helper", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-read-"));
    const groupDir = path.join(root, "groups", "g1");
    fs.mkdirSync(path.join(groupDir, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(groupDir, "deliverables", "memo.md"), "# memo");

    const result = readGroupWorkspaceFileContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g1",
      workspaceRoot: groupDir,
      relativePath: "deliverables/memo.md",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString()).toBe("# memo");
      expect(result.resourceId).toBe("ws:tenant-a:group:g1");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads group manifest through resolver helper", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-manifest-"));
    const groupDir = path.join(root, "groups", "g2");
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, ".manifest.json"),
      JSON.stringify({
        version: 1,
        drafts: { memo: { relativePath: "drafts/memo/content.md", updatedAtMs: 1 } },
        canonical: {},
      }),
    );

    const result = readGroupWorkspaceManifestContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g2",
      workspaceRoot: groupDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.missing).toBe(false);
      expect(result.manifest.drafts?.memo?.relativePath).toBe("drafts/memo/content.md");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns empty manifest when .manifest.json is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-manifest-missing-"));
    const groupDir = path.join(root, "groups", "g3");
    fs.mkdirSync(groupDir, { recursive: true });

    const result = readGroupWorkspaceManifestContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g3",
      workspaceRoot: groupDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.missing).toBe(true);
      expect(result.manifest).toEqual({ version: 1, drafts: {}, canonical: {} });
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes group deliverable through resolver helper", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-write-"));
    const groupDir = path.join(root, "groups", "g4");
    fs.mkdirSync(groupDir, { recursive: true });

    const writeResult = writeGroupWorkspaceRelativeFile({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g4",
      workspaceRoot: groupDir,
      relativePath: "deliverables/weekly-brief.md",
      content: "# Weekly brief",
      purpose: "knowledge.deliverables.saveAndArchive",
    });
    expect(writeResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(groupDir, "deliverables/weekly-brief.md"), "utf8")).toBe(
      "# Weekly brief",
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("upserts canonical manifest and removes draft tree through resolver", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-manifest-upsert-"));
    const groupDir = path.join(root, "groups", "g5");
    const workspacePath = groupDir;
    fs.mkdirSync(path.join(workspacePath, "drafts/market-brief"), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, "drafts/market-brief/content.md"), "draft body");
    writeGroupDeliverableManifest(workspacePath, {
      version: 1,
      drafts: {
        "market-brief": {
          relativePath: "drafts/market-brief/content.md",
          updatedAtMs: 1,
        },
      },
      canonical: {},
    });

    const result = upsertGroupWorkspaceDeliverableCanonical({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g5",
      workspaceRoot: groupDir,
      logicalId: "market-brief",
      relativePath: "deliverables/market-brief.md",
      deliverableId: "skill:abc",
      knowledgeBaseId: "kb-1",
    });
    expect(result.ok).toBe(true);
    const manifest = readGroupWorkspaceManifestContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g5",
      workspaceRoot: groupDir,
    });
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.manifest.canonical?.["market-brief"]).toMatchObject({
        relativePath: "deliverables/market-brief.md",
        deliverableId: "skill:abc",
        knowledgeBaseId: "kb-1",
      });
      expect(manifest.manifest.drafts?.["market-brief"]).toBeUndefined();
    }
    expect(fs.existsSync(path.join(workspacePath, "drafts/market-brief/content.md"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("upserts draft content and manifest through resolver", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-draft-upsert-"));
    const groupDir = path.join(root, "groups", "g6");
    fs.mkdirSync(groupDir, { recursive: true });

    const result = upsertGroupWorkspaceDeliverableDraft({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g6",
      workspaceRoot: groupDir,
      logicalId: "market-brief",
      title: "市场简报",
      content: "# 市场简报\n\n正文内容足够长。",
      workspaceFilename: "brief.docx",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relativePath).toBe("drafts/market-brief/content.md");
      expect(fs.readFileSync(path.join(groupDir, result.relativePath), "utf8")).toContain(
        "市场简报",
      );
    }
    const manifest = readGroupWorkspaceManifestContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g6",
      workspaceRoot: groupDir,
    });
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.manifest.drafts?.["market-brief"]).toMatchObject({
        relativePath: "drafts/market-brief/content.md",
        title: "市场简报",
        workspaceFilename: "brief.docx",
      });
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("prunes expired drafts through resolver", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-prune-"));
    const groupDir = path.join(root, "groups", "g7");
    fs.mkdirSync(path.join(groupDir, "drafts/stale-draft"), { recursive: true });
    fs.writeFileSync(path.join(groupDir, "drafts/stale-draft/content.md"), "old draft");
    writeGroupDeliverableManifest(groupDir, {
      version: 1,
      drafts: {
        "stale-draft": {
          relativePath: "drafts/stale-draft/content.md",
          updatedAtMs: Date.now() - DEFAULT_GROUP_DRAFT_TTL_MS - 60_000,
        },
      },
      canonical: {},
    });

    const result = pruneGroupWorkspaceExpiredDrafts({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g7",
      workspaceRoot: groupDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prunedLogicalIds).toEqual(["stale-draft"]);
      expect(result.manifestUpdated).toBe(true);
    }
    expect(fs.existsSync(path.join(groupDir, "drafts/stale-draft/content.md"))).toBe(false);
    const manifest = readGroupWorkspaceManifestContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g7",
      workspaceRoot: groupDir,
    });
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.manifest.drafts?.["stale-draft"]).toBeUndefined();
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists workspace deliverables directory via resolver", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-list-int-"));
    const groupDir = path.join(root, "groups", "g8");
    fs.mkdirSync(path.join(groupDir, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(groupDir, "deliverables", "one.md"), "# one");

    const result = listGroupWorkspaceRelativeDir({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g8",
      workspaceRoot: groupDir,
      relativeDir: "deliverables",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toContain("one.md");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies group writes when cutover store marks write_frozen", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-cutover-store-"));
    const groupDir = path.join(root, "groups", "g-cut");
    fs.mkdirSync(groupDir, { recursive: true });
    const storePath = path.join(root, ".meta", "workspace-cutover", "operations.json");
    const store = new FileWorkspaceCutoverStore(storePath);
    const resourceId = "ws:tenant-a:group:g-cut";
    let cutover = createWorkspaceCutoverOperation({
      operationId: "op-frozen-handler",
      resourceId,
      sourceBindingId: `${resourceId}:canonical`,
      targetBindingId: `${resourceId}:canonical:v2`,
      expectedContentVersion: "v2",
    });
    cutover = transitionWorkspaceCutoverOperation({ operation: cutover, nextState: "prepared" });
    cutover = transitionWorkspaceCutoverOperation({
      operation: cutover,
      nextState: "write_frozen",
    });
    store.save(cutover);

    const writeResult = writeGroupWorkspaceRelativeFile({
      catalog: createEmptyWorkspaceCatalog(),
      cutoverStore: store,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g-cut",
      workspaceRoot: groupDir,
      relativePath: "deliverables/blocked.md",
      content: "blocked",
    });
    expect(writeResult).toMatchObject({ ok: false, reason: "binding_not_found" });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
