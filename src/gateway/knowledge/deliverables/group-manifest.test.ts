// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_DRAFT_TTL_MS,
  readGroupDeliverableManifest,
  resolveDeliverableRelativePath,
  resolveLogicalId,
  pruneExpiredGroupDeliverableDrafts,
  upsertGroupDeliverableCanonical,
  upsertGroupDeliverableDraft,
  writeGroupDeliverableManifest,
} from "./group-manifest.js";

describe("resolveDeliverableRelativePath", () => {
  it("keeps the declared birth relative path instead of forcing deliverables/", () => {
    expect(
      resolveDeliverableRelativePath({
        logicalId: "deck",
        filename: "从干部培训到人才战略工程的落地方案.pptx",
      }),
    ).toBe("从干部培训到人才战略工程的落地方案.pptx");
    expect(
      resolveDeliverableRelativePath({
        logicalId: "deck",
        filename: "reports/从干部培训到人才战略工程的落地方案.pptx",
      }),
    ).toBe("reports/从干部培训到人才战略工程的落地方案.pptx");
    expect(
      resolveDeliverableRelativePath({
        logicalId: "deck",
        filename: "output/pptx/deck.pptx",
      }),
    ).toBe("output/pptx/deck.pptx");
  });

  it("falls back to deliverables/{logicalId}.md when no filename is declared", () => {
    expect(resolveDeliverableRelativePath({ logicalId: "weekly-brief" })).toBe(
      "deliverables/weekly-brief.md",
    );
  });

  it("rejects traversing filenames and falls back to the untitled capture path", () => {
    expect(
      resolveDeliverableRelativePath({
        logicalId: "weekly-brief",
        filename: "../secret.md",
      }),
    ).toBe("deliverables/weekly-brief.md");
  });
});

describe("group deliverable manifest", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeWorkspace() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-manifest-"));
    dirs.push(dir);
    return dir;
  }

  it("resolveLogicalId prefers explicit logicalId", () => {
    expect(resolveLogicalId({ explicit: "Weekly Report", title: "其他" })).toBe("weekly-report");
  });

  it("writes draft content and manifest draft entry", () => {
    const workspacePath = makeWorkspace();
    const { logicalId, relativePath } = upsertGroupDeliverableDraft({
      workspacePath,
      logicalId: "market-brief",
      title: "市场简报",
      content: "# 市场简报\n\n正文内容足够长。",
      workspaceFilename: "brief.docx",
    });
    expect(logicalId).toBe("market-brief");
    expect(relativePath).toBe("drafts/market-brief/content.md");
    expect(fs.readFileSync(path.join(workspacePath, relativePath), "utf8")).toContain("市场简报");

    const manifest = readGroupDeliverableManifest(workspacePath);
    expect(manifest.drafts?.["market-brief"]).toMatchObject({
      relativePath,
      title: "市场简报",
      workspaceFilename: "brief.docx",
    });
  });

  it("pins canonical entry and removes draft workspace tree", () => {
    const workspacePath = makeWorkspace();
    upsertGroupDeliverableDraft({
      workspacePath,
      logicalId: "market-brief",
      title: "市场简报",
      content: "draft body",
    });
    upsertGroupDeliverableCanonical({
      workspacePath,
      logicalId: "market-brief",
      relativePath: "deliverables/market-brief.md",
      deliverableId: "skill:abc",
      knowledgeBaseId: "kb-1",
    });
    const manifest = readGroupDeliverableManifest(workspacePath);
    expect(manifest.canonical?.["market-brief"]).toMatchObject({
      relativePath: "deliverables/market-brief.md",
      deliverableId: "skill:abc",
      knowledgeBaseId: "kb-1",
    });
    expect(manifest.drafts?.["market-brief"]).toBeUndefined();
    expect(fs.existsSync(path.join(workspacePath, "drafts/market-brief/content.md"))).toBe(false);
  });

  it("prunes expired drafts without canonical", () => {
    const workspacePath = makeWorkspace();
    upsertGroupDeliverableDraft({
      workspacePath,
      logicalId: "stale-draft",
      title: "过期草稿",
      content: "old draft",
    });
    const manifest = readGroupDeliverableManifest(workspacePath);
    manifest.drafts = manifest.drafts ?? {};
    manifest.drafts["stale-draft"] = {
      ...manifest.drafts["stale-draft"],
      updatedAtMs: Date.now() - DEFAULT_GROUP_DRAFT_TTL_MS - 60_000,
    };
    writeGroupDeliverableManifest(workspacePath, manifest);

    const result = pruneExpiredGroupDeliverableDrafts({ workspacePath });
    expect(result.prunedLogicalIds).toEqual(["stale-draft"]);
    expect(fs.existsSync(path.join(workspacePath, "drafts/stale-draft/content.md"))).toBe(false);
    expect(readGroupDeliverableManifest(workspacePath).drafts?.["stale-draft"]).toBeUndefined();
  });
});
