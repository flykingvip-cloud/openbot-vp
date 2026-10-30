import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveCollaborationQmdCollections,
  resolveCollaborationQmdCollectionsSync,
} from "./memory-index-paths.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const scopeCollectionBase = (base: string, agentId: string) => `${agentId}-${base}`;
const ensureUniqueName = (base: string, names: Set<string>) => {
  let candidate = base;
  let index = 1;
  while (names.has(candidate)) {
    candidate = `${base}-${index++}`;
  }
  return candidate;
};

describe("memory index paths", () => {
  it("builds qmd collections from authorized collaboration group memory dirs", async () => {
    const collaborationRoot = await makeTempDir("openbot-collab-index-");
    const groupId = "grp-index-test";
    const memoryDir = path.join(collaborationRoot, "groups", groupId, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, "SHARED_MEMORY.md"), "# shared\n", "utf8");

    const cfg = {
      agents: { defaults: { workspace: await makeTempDir("openbot-collab-ws-") } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    };

    const existing = new Set<string>();
    const collections = resolveCollaborationQmdCollectionsSync({
      cfg,
      agentId: "main",
      existingNames: existing,
      scopeCollectionBase,
      ensureUniqueName,
      authorizedGroupIds: [groupId],
    });

    expect(collections).toHaveLength(1);
    expect(collections[0]?.path).toBe(memoryDir);
    expect(collections[0]?.pattern).toBe("**/*.md");
  });

  it("default-denies QMD collab collections when authorizedGroupIds is omitted", async () => {
    const collaborationRoot = await makeTempDir("openbot-collab-deny-");
    const groupId = "grp-secret";
    const memoryDir = path.join(collaborationRoot, "groups", groupId, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, "SECRET.md"), "# secret marker BODY_LEAK\n", "utf8");

    const cfg = {
      agents: { defaults: { workspace: await makeTempDir("openbot-collab-ws-deny-") } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    };

    const syncCollections = resolveCollaborationQmdCollectionsSync({
      cfg,
      agentId: "main",
      existingNames: new Set(),
      scopeCollectionBase,
      ensureUniqueName,
      // authorizedGroupIds omitted → default deny
    });
    expect(syncCollections).toEqual([]);

    const asyncCollections = await resolveCollaborationQmdCollections({
      cfg,
      agentId: "main",
      existingNames: new Set(),
      scopeCollectionBase,
      ensureUniqueName,
    });
    expect(asyncCollections).toEqual([]);
  });

  it("excludes non-member groups from QMD collections", async () => {
    const collaborationRoot = await makeTempDir("openbot-collab-member-");
    const memberGroup = "grp-member";
    const otherGroup = "grp-other";
    for (const groupId of [memberGroup, otherGroup]) {
      const memoryDir = path.join(collaborationRoot, "groups", groupId, "memory");
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(
        path.join(memoryDir, "note.md"),
        `# ${groupId}\nMARKER_${groupId}\n`,
        "utf8",
      );
    }

    const cfg = {
      agents: { defaults: { workspace: await makeTempDir("openbot-collab-ws-member-") } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    };

    const collections = resolveCollaborationQmdCollectionsSync({
      cfg,
      agentId: "main",
      existingNames: new Set(),
      scopeCollectionBase,
      ensureUniqueName,
      authorizedGroupIds: new Set([memberGroup]),
    });

    expect(collections).toHaveLength(1);
    expect(collections[0]?.path).toContain(memberGroup);
    expect(collections.every((c) => !c.path.includes(otherGroup))).toBe(true);
    expect(JSON.stringify(collections)).not.toContain("MARKER_grp-other");
  });

  it("excludes cross-tenant groups from managed QMD collections", async () => {
    const tenantsRoot = await makeTempDir("openbot-collab-tenants-");
    const prevTenants = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const groupId = "shared-group-id";
      const tenantA = "tenant-a";
      const tenantB = "tenant-b";
      const memA = path.join(
        tenantsRoot,
        tenantA,
        "collaboration",
        "groups",
        encodeURIComponent(groupId),
        "memory",
      );
      const memB = path.join(
        tenantsRoot,
        tenantB,
        "collaboration",
        "groups",
        encodeURIComponent(groupId),
        "memory",
      );
      await fs.mkdir(memA, { recursive: true });
      await fs.mkdir(memB, { recursive: true });
      await fs.writeFile(path.join(memA, "a.md"), "# TENANT_A_BODY\n", "utf8");
      await fs.writeFile(path.join(memB, "b.md"), "# TENANT_B_SECRET\n", "utf8");

      const cfg = {
        agents: { defaults: { workspace: await makeTempDir("openbot-collab-ws-tenant-") } },
      };

      const collectionsA = resolveCollaborationQmdCollectionsSync({
        cfg,
        agentId: "main",
        existingNames: new Set(),
        scopeCollectionBase,
        ensureUniqueName,
        authorizedGroupIds: [groupId],
        tenantId: tenantA,
        profile: "managed_enterprise",
      });
      expect(collectionsA).toHaveLength(1);
      expect(collectionsA[0]?.path).toBe(memA);
      expect(JSON.stringify(collectionsA)).not.toContain("TENANT_B_SECRET");
      expect(collectionsA.every((c) => !c.path.includes(tenantB))).toBe(true);

      const collectionsEmpty = resolveCollaborationQmdCollectionsSync({
        cfg,
        agentId: "main",
        existingNames: new Set(),
        scopeCollectionBase,
        ensureUniqueName,
        authorizedGroupIds: [],
        tenantId: tenantA,
        profile: "managed_enterprise",
      });
      expect(collectionsEmpty).toEqual([]);

      const asyncA = await resolveCollaborationQmdCollections({
        cfg,
        agentId: "main",
        existingNames: new Set(),
        scopeCollectionBase,
        ensureUniqueName,
        authorizedGroupIds: new Set([groupId]),
        tenantId: tenantA,
        profile: "managed_enterprise",
      });
      expect(asyncA).toHaveLength(1);
      expect(asyncA[0]?.path).toBe(memA);
    } finally {
      if (prevTenants === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = prevTenants;
      }
    }
  });
});
