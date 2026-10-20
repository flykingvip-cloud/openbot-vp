import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { createEmptyWorkspaceCatalog, InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import {
  buildWorkspaceRelativePathCandidates,
  readStewardWorkspaceFileContent,
} from "./steward-read.js";

function seedCatalog(
  roots: Array<{ tenantId: string; userId: string; agentAssetId: string; workspaceRoot: string }>,
) {
  const resources: Record<
    string,
    ReturnType<typeof buildUserOwnedWorkspaceCatalogEntry>["resource"]
  > = {};
  const bindings: Record<
    string,
    ReturnType<typeof buildUserOwnedWorkspaceCatalogEntry>["binding"]
  > = {};
  for (const root of roots) {
    const entry = buildUserOwnedWorkspaceCatalogEntry(root);
    resources[entry.resource.resourceId] = entry.resource;
    bindings[entry.binding.bindingId] = entry.binding;
  }
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources,
    bindings,
  });
}

describe("steward workspace resolver integration", () => {
  it("reads from the primary agent workspace root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-read-"));
    const agentDir = path.join(root, "agents", "agt-hrqb", "workspace");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "report.pdf"), "pdf-bytes");

    const result = readStewardWorkspaceFileContent({
      catalog: seedCatalog([
        {
          tenantId: "personal-local",
          userId: "user-elle",
          agentAssetId: "agent:agt-hrqb",
          workspaceRoot: agentDir,
        },
      ]),
      actor: { tenantId: "personal-local", userId: "user-elle" },
      tenantId: "personal-local",
      userId: "user-elle",
      roots: [{ agentAssetId: "agent:agt-hrqb", workspaceRoot: agentDir }],
      relativePath: "report.pdf",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString()).toBe("pdf-bytes");
      expect(result.resourceId).toBe("ws:personal-local:user:user-elle:asset:agent:agt-hrqb");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("falls back to the steward isolation workspace when agent root misses", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-fallback-"));
    const agentDir = path.join(root, "agents", "main", "workspace");
    const stewardDir = path.join(root, "user-elle", "workspace");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(stewardDir, { recursive: true });
    fs.writeFileSync(path.join(stewardDir, "memo.md"), "# memo");

    const result = readStewardWorkspaceFileContent({
      catalog: seedCatalog([
        {
          tenantId: "personal-local",
          userId: "user-elle",
          agentAssetId: "agent:main",
          workspaceRoot: agentDir,
        },
        {
          tenantId: "personal-local",
          userId: "user-elle",
          agentAssetId: "steward:builtin",
          workspaceRoot: stewardDir,
        },
      ]),
      actor: { tenantId: "personal-local", userId: "user-elle" },
      tenantId: "personal-local",
      userId: "user-elle",
      roots: [
        { agentAssetId: "agent:main", workspaceRoot: agentDir },
        { agentAssetId: "steward:builtin", workspaceRoot: stewardDir },
      ],
      relativePath: "memo.md",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString()).toBe("# memo");
      expect(result.resourceId).toBe("ws:personal-local:user:user-elle:asset:steward:builtin");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not open a same-name file in another directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-candidates-"));
    const stewardDir = path.join(root, "user-elle", "workspace");
    fs.mkdirSync(path.join(stewardDir, "deliverables"), { recursive: true });
    fs.mkdirSync(path.join(stewardDir, "campaigns", "october"), { recursive: true });
    fs.writeFileSync(path.join(stewardDir, "deliverables", "article.html"), "TWIN");
    fs.writeFileSync(path.join(stewardDir, "campaigns", "october", "article.html"), "NESTED");

    const nested = readStewardWorkspaceFileContent({
      catalog: seedCatalog([
        {
          tenantId: "personal-local",
          userId: "user-elle",
          agentAssetId: "steward:builtin",
          workspaceRoot: stewardDir,
        },
      ]),
      actor: { tenantId: "personal-local", userId: "user-elle" },
      tenantId: "personal-local",
      userId: "user-elle",
      roots: [{ agentAssetId: "steward:builtin", workspaceRoot: stewardDir }],
      relativePath: "campaigns/october/article.html",
    });
    expect(nested.ok).toBe(true);
    if (nested.ok) {
      expect(nested.relativePath).toBe("campaigns/october/article.html");
      expect(nested.buffer.toString()).toBe("NESTED");
    }
    const bare = readStewardWorkspaceFileContent({
      catalog: seedCatalog([
        {
          tenantId: "personal-local",
          userId: "user-elle",
          agentAssetId: "steward:builtin",
          workspaceRoot: stewardDir,
        },
      ]),
      actor: { tenantId: "personal-local", userId: "user-elle" },
      tenantId: "personal-local",
      userId: "user-elle",
      roots: [{ agentAssetId: "steward:builtin", workspaceRoot: stewardDir }],
      relativePath: "article.html",
    });
    expect(bare.ok).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("buildWorkspaceRelativePathCandidates", () => {
  it("keeps the declared path and does not add other directories", () => {
    expect(buildWorkspaceRelativePathCandidates("全球热点简报-2026-10-14.html")).toEqual([
      "全球热点简报-2026-10-14.html",
    ]);
    expect(buildWorkspaceRelativePathCandidates("campaigns/october/article.html")).toEqual([
      "campaigns/october/article.html",
    ]);
    expect(buildWorkspaceRelativePathCandidates("campaigns/../../secret.html")).toEqual([]);
  });
});
