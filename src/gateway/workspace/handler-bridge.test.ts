import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agent-registry/store.js", () => ({
  loadAgentRegistryStore: async () => ({
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  }),
}));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: async () => null,
  resolveAgentWorkspaceDirForClient: async () => "/tmp/unused",
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => false,
  resolveDataMode: () => "local",
}));

const {
  authorizeAgentWorkspaceFileAccess,
  authorizeGroupWorkspaceFileAccess,
  isDeniedSharedHostRoot,
  normalizeRelativeWorkspacePath,
  resolveTrustedGroupLocator,
} = await import("./handler-bridge.js");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("handler-bridge", () => {
  it("rejects traversal and absolute paths", () => {
    expect(normalizeRelativeWorkspacePath("../x")).toBeNull();
    expect(normalizeRelativeWorkspacePath("/etc/passwd")).toBeNull();
    expect(normalizeRelativeWorkspacePath("ok/file.md")).toBe("ok/file.md");
  });

  it("denies canvas and host skill roots as workspace candidates", () => {
    expect(isDeniedSharedHostRoot("/var/lib/openbot/canvas")).toBe(true);
    expect(isDeniedSharedHostRoot("/var/lib/openbot/skills")).toBe(true);
    expect(isDeniedSharedHostRoot("/var/lib/openbot/workspace-agent-a")).toBe(false);
    expect(isDeniedSharedHostRoot("/var/lib/openbot/tenants/t1/users/u1/OpenBot/workspace")).toBe(
      false,
    );
    expect(
      isDeniedSharedHostRoot("/var/lib/openbot/tenants/t1/users/u1/OpenBot/workspace-agent-a"),
    ).toBe(false);
    expect(
      isDeniedSharedHostRoot(
        "/root/openbot-tenants/001/users/90fed19a-1c8b-4420-87e0-bcc6165e32fa/OpenBot/workspace-agent-a",
      ),
    ).toBe(false);
  });

  it("authorizes steward reads inside the trusted locator only", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hb-steward-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "notes.md"), "hello");
    const ok = await authorizeAgentWorkspaceFileAccess({
      client: null,
      cfg: {},
      userId: "u1",
      agentId: "main",
      relativePath: "notes.md",
      operation: "read",
      purpose: "test",
      locator: root,
      stewardException: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(fs.readFileSync(ok.absoluteFilePath, "utf8")).toBe("hello");
    }

    const denied = await authorizeAgentWorkspaceFileAccess({
      client: null,
      cfg: {},
      userId: "u1",
      agentId: "main",
      relativePath: "notes.md",
      operation: "read",
      purpose: "test",
      locator: path.join(root, "canvas"),
      stewardException: true,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe("shared_root_denied");
    }
  });

  it("requires verified group ACL and classifies group_owned", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hb-group-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "deck.md"), "g");
    const denied = await authorizeGroupWorkspaceFileAccess({
      client: null,
      cfg: {},
      userId: "u1",
      groupId: "g1",
      relativePath: "deck.md",
      operation: "read",
      purpose: "test",
      locator: root,
      groupAclVerified: false,
    });
    expect(denied.ok).toBe(false);

    const ok = await authorizeGroupWorkspaceFileAccess({
      client: null,
      cfg: {},
      userId: "u1",
      groupId: "g1",
      relativePath: "deck.md",
      operation: "read",
      purpose: "test",
      locator: root,
      groupAclVerified: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.access.ownerScope.kind).toBe("group_owned");
    }
  });

  it("isolates the same groupId under different managed tenants (C5)", async () => {
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-tenants-"));
    tempDirs.push(tenantsRoot);
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const locatorA = resolveTrustedGroupLocator({
        groupId: "shared-gid",
        tenantId: "tenant-a",
        profile: "managed_enterprise",
        cfg: {},
      });
      const locatorB = resolveTrustedGroupLocator({
        groupId: "shared-gid",
        tenantId: "tenant-b",
        profile: "managed_enterprise",
        cfg: {},
      });
      expect(locatorA).not.toBe(locatorB);
      fs.mkdirSync(locatorA, { recursive: true });
      fs.mkdirSync(locatorB, { recursive: true });
      fs.writeFileSync(path.join(locatorA, "deck.md"), "tenant-a-secret");
      fs.writeFileSync(path.join(locatorB, "deck.md"), "tenant-b-secret");

      const readA = await authorizeGroupWorkspaceFileAccess({
        client: null,
        cfg: {},
        userId: "u-a",
        groupId: "shared-gid",
        relativePath: "deck.md",
        operation: "read",
        purpose: "test",
        locator: locatorA,
        groupAclVerified: true,
        authoritativeTenantId: "tenant-a",
      });
      expect(readA.ok).toBe(true);
      if (readA.ok) {
        expect(fs.readFileSync(readA.absoluteFilePath, "utf8")).toBe("tenant-a-secret");
        expect(readA.access.baseReal).toBe(fs.realpathSync(locatorA));
        expect(readA.access.baseReal).not.toBe(fs.realpathSync(locatorB));
      }

      const readB = await authorizeGroupWorkspaceFileAccess({
        client: null,
        cfg: {},
        userId: "u-b",
        groupId: "shared-gid",
        relativePath: "deck.md",
        operation: "read",
        purpose: "test",
        locator: locatorB,
        groupAclVerified: true,
        authoritativeTenantId: "tenant-b",
      });
      expect(readB.ok).toBe(true);
      if (readB.ok) {
        expect(fs.readFileSync(readB.absoluteFilePath, "utf8")).toBe("tenant-b-secret");
      }
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });
});
