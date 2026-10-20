import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";

const securityState = vi.hoisted(() => ({
  profile: "personal_local" as "personal_local" | "managed_enterprise",
}));

vi.mock("../../gateway/security-profile.js", () => ({
  resolveSecurityProfile: () => ({
    ok: true,
    profile: securityState.profile,
    isolationLevel: securityState.profile === "managed_enterprise" ? "I3" : "I1",
    source: "test",
    tenantExecutionBoundary: securityState.profile === "managed_enterprise" ? "dedicated" : "unset",
    errors: [],
  }),
}));

const {
  buildCollaborationGroupMissionPrompt,
  isCollaborationGroupRuntimeSession,
  resolveCollaborationGroupIdForRun,
  resolveCollaborationRunWorkspaceDir,
  shouldUseCollaborationRuntimeAssembly,
} = await import("./runtime-context-assembly.js");

let tempRoot: string | undefined;

afterEach(() => {
  securityState.profile = "personal_local";
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("runtime context assembly", () => {
  it("uses collaboration assembly for an invoked group turn without session group fields", () => {
    expect(
      shouldUseCollaborationRuntimeAssembly({
        collaborationGroupId: "grp-turn",
        collaborationRoundInvoked: true,
        sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
      }),
    ).toBe(true);
    expect(
      shouldUseCollaborationRuntimeAssembly({
        collaborationGroupId: "grp-turn",
        sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
      }),
    ).toBe(false);
  });

  it("detects collaboration group sessions", () => {
    expect(
      isCollaborationGroupRuntimeSession({
        groupId: "grp-a",
        sessionEntry: {
          collaborationGroupProfile: { groupId: "grp-a", updatedAtMs: 1 },
        } as SessionEntry,
      }),
    ).toBe(true);
    expect(
      isCollaborationGroupRuntimeSession({
        groupId: "grp-a",
        sessionEntry: { space: "grp-a" } as SessionEntry,
      }),
    ).toBe(true);
  });

  it("builds mission prompt from collaboration group profile", () => {
    const prompt = buildCollaborationGroupMissionPrompt({
      collaborationGroupProfile: {
        groupId: "grp-a",
        displayName: "数字人战队",
        purpose: "战略研究和咨询",
        currentMission: "完成成员介绍",
        updatedAtMs: 1,
      },
    } as SessionEntry);
    expect(prompt).toContain("数字人战队");
    expect(prompt).toContain("战略研究和咨询");
    expect(prompt).toContain("完成成员介绍");
  });

  it("builds mission prompt from a resolved disk profile when session has none", () => {
    const prompt = buildCollaborationGroupMissionPrompt({ space: "grp-a" } as SessionEntry, {
      groupId: "grp-a",
      displayName: "数字人测试",
      systemInstructions: ["被 @ 时必须回应"],
      updatedAtMs: 1,
    });
    expect(prompt).toContain("数字人测试");
    expect(prompt).toContain("被 @ 时必须回应");
  });

  it("resolves collaboration run workspace from configured group root", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/agent-ws" } },
      collaboration: { defaults: { workspace: "/tmp/collab-root" } },
    } satisfies OpenBotConfig;
    const workspace = resolveCollaborationRunWorkspaceDir({
      cfg,
      agentWorkspaceDir: "/tmp/agent-ws",
      groupId: "grp-a",
      sessionEntry: {
        space: "grp-a",
        collaborationGroupProfile: { groupId: "grp-a", updatedAtMs: 1 },
      } as SessionEntry,
    });
    expect(workspace).toBe("/tmp/collab-root/groups/grp-a");
  });

  it("prefers CollaborationGroupId over session-entry heuristics", () => {
    expect(
      resolveCollaborationGroupIdForRun({
        collaborationGroupId: "grp-from-ctx",
        groupSessionId: "grp-from-key",
        sessionEntry: { space: "grp-from-space" } as SessionEntry,
      }),
    ).toBe("grp-from-ctx");
  });

  it("falls back to session entry space when CollaborationGroupId is absent", () => {
    expect(
      resolveCollaborationGroupIdForRun({
        sessionEntry: { space: "grp-from-space" } as SessionEntry,
      }),
    ).toBe("grp-from-space");
  });

  it("uses explicit groupId without sessionEntry match (collab bot path)", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/agent-ws" } },
      collaboration: { defaults: { workspace: "/tmp/collab-root" } },
    } satisfies OpenBotConfig;
    // Per-bot SessionEntry often has no space/groupId even on group turns.
    const workspace = resolveCollaborationRunWorkspaceDir({
      cfg,
      agentWorkspaceDir: "/tmp/agent-ws",
      groupId: "grp-explicit",
      sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
    });
    expect(workspace).toBe("/tmp/collab-root/groups/grp-explicit");
  });

  it("managed_enterprise without tenant fails closed (no personal/agent degrade)", () => {
    securityState.profile = "managed_enterprise";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-collab-ws-"));
    const collabRoot = path.join(tempRoot, "collab-root");
    const groupDir = path.join(collabRoot, "groups", "grp-live");
    fs.mkdirSync(groupDir, { recursive: true });
    const agentWs = path.join(tempRoot, "agent-ws");
    fs.mkdirSync(agentWs, { recursive: true });
    const cfg = {
      agents: { defaults: { workspace: agentWs } },
      collaboration: { defaults: { workspace: collabRoot } },
    } satisfies OpenBotConfig;

    expect(() =>
      resolveCollaborationRunWorkspaceDir({
        cfg,
        agentWorkspaceDir: agentWs,
        groupId: "grp-live",
        // Missing CollaborationTenantId — must match group-file.read refuse, not personal success.
        tenantId: null,
        sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
      }),
    ).toThrow(/trusted tenant context required/);
  });

  it("managed_enterprise with tenantId uses managed group locator (not personal fallback)", () => {
    securityState.profile = "managed_enterprise";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-collab-managed-"));
    const collabRoot = path.join(tempRoot, "collab-root");
    const personalGroup = path.join(collabRoot, "groups", "grp-live");
    fs.mkdirSync(personalGroup, { recursive: true });
    const tenantsRoot = path.join(tempRoot, "tenants");
    const stateDir = path.join(tempRoot, "state");
    fs.mkdirSync(tenantsRoot, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    const previous = {
      OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
    };
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const cfg = {
        agents: { defaults: { workspace: path.join(tempRoot, "agent-ws") } },
        collaboration: { defaults: { workspace: collabRoot } },
      } satisfies OpenBotConfig;

      const workspace = resolveCollaborationRunWorkspaceDir({
        cfg,
        agentWorkspaceDir: path.join(tempRoot, "agent-ws"),
        groupId: "grp-live",
        tenantId: "tenant-001",
        sessionEntry: { space: "grp-live" } as SessionEntry,
      });
      // PR A: tenant-scoped managed locator wins even when personal exists and managed is empty.
      expect(workspace).toContain(
        `${path.sep}tenant-001${path.sep}collaboration${path.sep}groups${path.sep}`,
      );
      expect(workspace).not.toBe(personalGroup);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("managed_enterprise without tenant fails even when personal group root is absent", () => {
    securityState.profile = "managed_enterprise";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-collab-missing-"));
    const collabRoot = path.join(tempRoot, "collab-root");
    fs.mkdirSync(collabRoot, { recursive: true });
    // deliberately do NOT create groups/grp-missing on disk yet
    const agentWs = path.join(tempRoot, "agent-ws");
    fs.mkdirSync(agentWs, { recursive: true });
    const cfg = {
      agents: { defaults: { workspace: agentWs } },
      collaboration: { defaults: { workspace: collabRoot } },
    } satisfies OpenBotConfig;

    expect(() =>
      resolveCollaborationRunWorkspaceDir({
        cfg,
        agentWorkspaceDir: agentWs,
        groupId: "grp-missing",
        tenantId: null,
      }),
    ).toThrow(/trusted tenant context required/);
  });

  it("managed_enterprise with tenantId returns managed group locator even if absent on disk", () => {
    securityState.profile = "managed_enterprise";
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-collab-managed-absent-"));
    const tenantsRoot = path.join(tempRoot, "tenants");
    const stateDir = path.join(tempRoot, "state");
    fs.mkdirSync(tenantsRoot, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    const agentWs = path.join(tempRoot, "agent-ws");
    fs.mkdirSync(agentWs, { recursive: true });
    const previous = {
      OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
    };
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const cfg = {
        agents: { defaults: { workspace: agentWs } },
        collaboration: { defaults: { workspace: path.join(tempRoot, "collab") } },
      } satisfies OpenBotConfig;
      const workspace = resolveCollaborationRunWorkspaceDir({
        cfg,
        agentWorkspaceDir: agentWs,
        groupId: "grp-absent",
        tenantId: "001",
      });
      expect(workspace).toContain(
        `${path.sep}001${path.sep}collaboration${path.sep}groups${path.sep}`,
      );
      expect(workspace).toContain("grp-absent");
      expect(workspace).not.toBe(agentWs);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
