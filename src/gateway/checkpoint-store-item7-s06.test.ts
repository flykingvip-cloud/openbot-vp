import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "./workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "./workspace-resolver/catalog.js";
import { resolveWorkspaceLocator } from "./workspace-resolver/strict-locator.js";

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "checkpoint-store.ts"),
  "utf8",
);

describe("Item 7 batch 4 S06 checkpoint-store steward lookup", () => {
  it("replaces resolveEmployeeBuiltinStewardWorkspaceDir with fail-closed resolveWorkspaceLocator", () => {
    expect(source).toContain("resolveWorkspaceLocator");
    expect(source).toContain("steward:builtin");
    expect(source).not.toContain("resolveEmployeeBuiltinStewardWorkspaceDir");
    expect(source).not.toContain("createEmptyWorkspaceCatalog");
    expect(source).not.toContain("resolveWorkspaceResource");
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
        tenantId: "tenant-a",
        tenantContext: {
          tenantId: "tenant-a",
          userId: "user-elle",
          domain: "enterprise",
        },
        actor: {
          userId: "user-elle",
          grant: { kind: "user", subjectId: "user-elle", purpose: "checkpoint.steward" },
        },
        agentAssetId: "steward:builtin",
      }),
    ).toMatchObject({ ok: false, failClosed: true });
  });

  it("pass-after resolves steward workspace root when catalog binding exists", () => {
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "steward:builtin",
      workspaceRoot: "/var/workspaces/tenant-a/steward-builtin",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    const located = resolveWorkspaceLocator({
      tenantContext: {
        tenantId: "tenant-a",
        userId: "user-elle",
        domain: "enterprise" as const,
      },
      tenantId: "tenant-a",
      actor: {
        userId: "user-elle",
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch4-s06" },
      },
      resourceId: entry.resource.resourceId,
      agentAssetId: "steward:builtin",
      catalog,
      cfg: managedCfg,
    });
    expect(located.ok).toBe(true);
    if (!located.ok) {
      return;
    }
    expect(located.handle.locator).toBe("/var/workspaces/tenant-a/steward-builtin");
  });
});
