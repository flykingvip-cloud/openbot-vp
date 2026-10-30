import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { ownershipProofFromTenantUser } from "../gateway/data-governance/ownership-proof.js";
import {
  assertMemoryContinuityPathAccess,
  filterMemorySearchResultsForAuthz,
  parseCollaborationMemoryGroupId,
  resolveMemoryContinuityAuthz,
} from "./memory-continuity-authz.js";
import type { MemorySearchResult } from "./types.js";

const cleanup: string[] = [];
const envKeys = [
  "OPENBOT_STATE_DIR",
  "OPENBOT_CONFIG_PATH",
  "OPENCLAW_CONFIG_PATH",
  "OPENBOT_TENANTS_ROOT",
  "OPENCLAW_DISABLE_CONFIG_CACHE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

type IsolatedDirs = {
  stateDir: string;
  collabRoot: string;
  tenantsRoot: string;
};

async function withIsolatedState<T>(run: (dirs: IsolatedDirs) => Promise<T>): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-authz-state-"));
  const tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mem-authz-tenants-"));
  cleanup.push(stateDir, tenantsRoot);
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
  const configPath = path.join(stateDir, "openbot.json");
  const collabRoot = path.join(stateDir, "collab-workspace");
  await fs.mkdir(path.join(collabRoot, "groups"), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({
      collaboration: { defaults: { workspace: collabRoot } },
      agents: { list: [{ id: "main", default: true }] },
    }),
    "utf8",
  );
  process.env.OPENBOT_STATE_DIR = stateDir;
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  try {
    return await run({ stateDir, collabRoot, tenantsRoot });
  } finally {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  }
}

async function writeMembers(
  groupDir: string,
  members: Array<{ userId: string; status: string }>,
): Promise<void> {
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(
    path.join(groupDir, "members.json"),
    JSON.stringify(
      members.map((m, i) => ({
        memberId: `m-${i}`,
        memberKind: "human",
        userId: m.userId,
        governanceRole: "member",
        status: m.status,
        updatedAtMs: Date.now(),
      })),
    ),
    "utf8",
  );
}

describe("memory-continuity-authz", () => {
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("parses collaboration memory group ids", () => {
    expect(parseCollaborationMemoryGroupId("collaboration/g1/memory/note.md")).toBe("g1");
    expect(parseCollaborationMemoryGroupId("memory/note.md")).toBeNull();
  });

  it("documents permission source members.json for personal_local", async () => {
    await withIsolatedState(async ({ collabRoot }) => {
      const groupId = "group-alpha";
      const groupDir = path.join(collabRoot, "groups", encodeURIComponent(groupId));
      await writeMembers(groupDir, [
        { userId: "alice", status: "active" },
        { userId: "bob", status: "revoked" },
      ]);
      await fs.mkdir(path.join(groupDir, "memory"), { recursive: true });
      await fs.writeFile(path.join(groupDir, "memory", "note.md"), "secret-note", "utf8");

      const cfg = {
        collaboration: { defaults: { workspace: collabRoot } },
        agents: { list: [{ id: "main", default: true }] },
      };

      const alice = await resolveMemoryContinuityAuthz({
        cfg,
        authenticatedUserId: "alice",
        profile: "personal_local",
      });
      expect(alice.permissionSource).toBe("members.json");
      expect([...alice.authorizedGroupIds]).toEqual([groupId]);
      expect(alice.roots).toHaveLength(1);

      const bob = await resolveMemoryContinuityAuthz({
        cfg,
        authenticatedUserId: "bob",
        profile: "personal_local",
      });
      expect(bob.authorizedGroupIds.has(groupId)).toBe(false);

      const allowed = await assertMemoryContinuityPathAccess({
        relPath: `collaboration/${groupId}/memory/note.md`,
        authz: alice,
        cfg,
      });
      expect(allowed.ok).toBe(true);

      const denied = await assertMemoryContinuityPathAccess({
        relPath: `collaboration/${groupId}/memory/note.md`,
        authz: bob,
        cfg,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.reasonCode).toBe("revoked_or_inactive");
        expect(denied.reason).toBe("not authorized");
        expect(JSON.stringify(denied)).not.toContain("secret-note");
      }
    });
  });

  it("isolates managed tenants with same groupId (permission source governance.tenantId+members.json)", async () => {
    await withIsolatedState(async ({ tenantsRoot }) => {
      const groupId = "shared-gid";
      for (const tid of ["tenant-a", "tenant-b"]) {
        const groupDir = path.join(
          tenantsRoot,
          tid,
          "collaboration",
          "groups",
          encodeURIComponent(groupId),
        );
        await writeMembers(groupDir, [{ userId: `${tid}-user`, status: "active" }]);
        await fs.mkdir(path.join(groupDir, "memory"), { recursive: true });
        await fs.writeFile(path.join(groupDir, "memory", "note.md"), `body-for-${tid}`, "utf8");
      }

      const cfg = { agents: { list: [{ id: "main", default: true }] } };
      const authzA = await resolveMemoryContinuityAuthz({
        cfg,
        governance: {
          tenantId: "tenant-a",
          ownershipProof: ownershipProofFromTenantUser({
            tenantId: "tenant-a",
            userId: "tenant-a-user",
          }),
        },
        profile: "managed_enterprise",
      });
      expect(authzA.permissionSource).toBe("governance.tenantId+members.json");
      expect(authzA.authorizedGroupIds.has(groupId)).toBe(true);

      const authzBUserOnA = await resolveMemoryContinuityAuthz({
        cfg,
        governance: {
          tenantId: "tenant-a",
          ownershipProof: ownershipProofFromTenantUser({
            tenantId: "tenant-a",
            userId: "tenant-b-user",
          }),
        },
        profile: "managed_enterprise",
      });
      expect(authzBUserOnA.authorizedGroupIds.has(groupId)).toBe(false);

      const denied = await assertMemoryContinuityPathAccess({
        relPath: `collaboration/${groupId}/memory/note.md`,
        authz: authzBUserOnA,
        cfg,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(["cross_tenant", "non_member"]).toContain(denied.reasonCode);
        expect(JSON.stringify(denied)).not.toContain("body-for");
      }
    });
  });

  it("filterMemorySearchResultsForAuthz drops unauthorized collab hits without rewriting snippets", () => {
    const results: MemorySearchResult[] = [
      {
        path: "memory/personal.md",
        startLine: 1,
        endLine: 1,
        score: 1,
        snippet: "ok-personal",
        source: "memory",
      },
      {
        path: "collaboration/g-ok/memory/a.md",
        startLine: 1,
        endLine: 1,
        score: 1,
        snippet: "ok-group",
        source: "memory",
      },
      {
        path: "collaboration/g-deny/memory/b.md",
        startLine: 1,
        endLine: 1,
        score: 1,
        snippet: "LEAK-ME",
        source: "memory",
      },
    ];
    const filtered = filterMemorySearchResultsForAuthz({
      results,
      authz: {
        tenantId: null,
        userId: "alice",
        profile: "personal_local",
        authorizedGroupIds: new Set(["g-ok"]),
        permissionSource: "members.json",
        roots: [],
      },
    });
    expect(filtered.map((r) => r.path)).toEqual([
      "memory/personal.md",
      "collaboration/g-ok/memory/a.md",
    ]);
    expect(filtered.every((r) => !r.snippet.includes("LEAK"))).toBe(true);
  });
});
