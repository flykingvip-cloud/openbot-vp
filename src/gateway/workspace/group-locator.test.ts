import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveLiveCollaborationWorkspaceRoot,
  resolveTrustedGroupLocator,
} from "./group-locator.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveTrustedGroupLocator", () => {
  it("requires tenant context in managed enterprise", () => {
    expect(() =>
      resolveTrustedGroupLocator({
        groupId: "g1",
        tenantId: null,
        profile: "managed_enterprise",
        cfg: {},
      }),
    ).toThrow(/trusted tenant context required/);
  });

  it("encodes unicode groupId and stays on the tenant collaboration tree", () => {
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gl-tenants-"));
    tempDirs.push(tenantsRoot);
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const groupId = "grp-hrqb-163-com-权变管理专家";
      const locator = resolveTrustedGroupLocator({
        groupId,
        tenantId: "001",
        profile: "managed_enterprise",
        cfg: {},
      });
      expect(locator).toBe(
        path.join(tenantsRoot, "001", "collaboration", "groups", encodeURIComponent(groupId)),
      );
      expect(locator.includes(".openclaw")).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("separates same groupId by tenant under managed enterprise", () => {
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gl-tenants-"));
    tempDirs.push(tenantsRoot);
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const a = resolveTrustedGroupLocator({
        groupId: "g1",
        tenantId: "t-a",
        profile: "managed_enterprise",
        cfg: {},
      });
      const b = resolveTrustedGroupLocator({
        groupId: "g1",
        tenantId: "t-b",
        profile: "managed_enterprise",
        cfg: {},
      });
      expect(a).toContain(`${path.sep}t-a${path.sep}`);
      expect(b).toContain(`${path.sep}t-b${path.sep}`);
      expect(a).not.toBe(b);
      expect(a).toBe(path.join(tenantsRoot, "t-a", "collaboration", "groups", "g1"));
      expect(a.includes(`${path.sep}.openclaw${path.sep}`)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("keeps personal local groups on stateDir/collaboration even when a tenant id is present", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "gl-state-local-"));
    tempDirs.push(stateDir);
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      expect(
        resolveTrustedGroupLocator({
          groupId: "g1",
          tenantId: "001",
          profile: "personal_local",
          cfg: { agents: { list: [{ id: "main", workspace: "/tmp/robot-checkout" }] } },
        }),
      ).toBe(path.join(stateDir, "collaboration", "groups", "g1"));
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
    }
  });

  it("does not treat a git checkout as the live group write root", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "gl-state-git-"));
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "gl-git-checkout-"));
    tempDirs.push(stateDir, checkout);
    fs.mkdirSync(path.join(checkout, ".git"));
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const locator = resolveTrustedGroupLocator({
        groupId: "g1",
        tenantId: null,
        profile: "personal_local",
        cfg: { collaboration: { defaults: { workspace: checkout } } },
      });
      expect(locator).toBe(path.join(stateDir, "collaboration", "groups", "g1"));
      expect(locator.startsWith(checkout)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
    }
  });
});

describe("resolveLiveCollaborationWorkspaceRoot", () => {
  it("uses a non-git configured collaboration workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gl-collab-root-"));
    tempDirs.push(root);
    expect(
      resolveLiveCollaborationWorkspaceRoot({ collaboration: { defaults: { workspace: root } } }),
    ).toBe(path.resolve(root));
  });

  it("redirects a missing or git-checkout config to stateDir/collaboration", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "gl-state-redirect-"));
    tempDirs.push(stateDir);
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      expect(resolveLiveCollaborationWorkspaceRoot({})).toBe(path.join(stateDir, "collaboration"));
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
    }
  });
});
