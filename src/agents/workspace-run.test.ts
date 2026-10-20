import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { seatOwnedWriteOwnership } from "../gateway/workspace-resolver/canonical-write-root.js";
import { resolveRobotOwnWriteRoot } from "../gateway/workspace-resolver/write-roots.js";
import { resolveRunWorkspaceDir } from "./workspace-run.js";

describe("resolveRunWorkspaceDir", () => {
  it("resolves explicit workspace values without fallback", () => {
    const explicit = path.join(process.cwd(), "tmp", "workspace-run-explicit");
    const result = resolveRunWorkspaceDir({
      workspaceDir: explicit,
      sessionKey: "agent:main:subagent:test",
    });

    expect(result.usedFallback).toBe(false);
    expect(result.agentId).toBe("main");
    expect(result.workspaceDir).toBe(path.resolve(explicit));
  });

  it("falls back to agents.defaults.workspace when input is missing", () => {
    const defaultWorkspace = path.join(process.cwd(), "tmp", "workspace-default-main");
    const researchWorkspace = path.join(process.cwd(), "tmp", "workspace-research");
    const cfg = {
      agents: {
        defaults: { workspace: defaultWorkspace },
        list: [{ id: "research", workspace: researchWorkspace }],
      },
    } satisfies OpenBotConfig;

    const result = resolveRunWorkspaceDir({
      workspaceDir: undefined,
      sessionKey: "agent:research:subagent:test",
      config: cfg,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("missing");
    expect(result.agentId).toBe("research");
    expect(result.workspaceDir).toBe(path.resolve(defaultWorkspace));
    expect(result.workspaceDir).not.toContain("workspace-research");
  });

  it("falls back to default workspace for blank strings", () => {
    const defaultWorkspace = path.join(process.cwd(), "tmp", "workspace-default-main");
    const cfg = {
      agents: {
        defaults: { workspace: defaultWorkspace },
      },
    } satisfies OpenBotConfig;

    const result = resolveRunWorkspaceDir({
      workspaceDir: "   ",
      sessionKey: "agent:main:subagent:test",
      config: cfg,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("blank");
    expect(result.agentId).toBe("main");
    expect(result.workspaceDir).toBe(path.resolve(defaultWorkspace));
  });

  it("throws when config is unavailable instead of host workspace-<id>", () => {
    expect(() =>
      resolveRunWorkspaceDir({
        workspaceDir: null,
        sessionKey: "agent:main:subagent:test",
        config: undefined,
      }),
    ).toThrow(/refusing host workspace-<id>/);
  });

  it("throws for malformed agent session keys", () => {
    expect(() =>
      resolveRunWorkspaceDir({
        workspaceDir: undefined,
        sessionKey: "agent::broken",
        config: undefined,
      }),
    ).toThrow("Malformed agent session key");
  });

  it("throws for explicit agent id when config is unavailable instead of host workspace-<id>", () => {
    expect(() =>
      resolveRunWorkspaceDir({
        workspaceDir: undefined,
        sessionKey: "definitely-not-a-valid-session-key",
        agentId: "research",
        config: undefined,
      }),
    ).toThrow(/refusing host workspace-<id>/);
  });

  it("throws for malformed agent session keys even when config has a default agent", () => {
    const mainWorkspace = path.join(process.cwd(), "tmp", "workspace-main-default");
    const researchWorkspace = path.join(process.cwd(), "tmp", "workspace-research-default");
    const cfg = {
      agents: {
        defaults: { workspace: mainWorkspace },
        list: [
          { id: "main", workspace: mainWorkspace },
          { id: "research", workspace: researchWorkspace, default: true },
        ],
      },
    } satisfies OpenBotConfig;

    expect(() =>
      resolveRunWorkspaceDir({
        workspaceDir: undefined,
        sessionKey: "agent::broken",
        config: cfg,
      }),
    ).toThrow("Malformed agent session key");
  });

  it("treats non-agent legacy keys as default, not malformed", () => {
    const fallbackWorkspace = path.join(process.cwd(), "tmp", "workspace-default-legacy");
    const cfg = {
      agents: {
        defaults: { workspace: fallbackWorkspace },
      },
    } satisfies OpenBotConfig;

    const result = resolveRunWorkspaceDir({
      workspaceDir: undefined,
      sessionKey: "custom-main-key",
      config: cfg,
    });

    expect(result.agentId).toBe("main");
    expect(result.agentIdSource).toBe("default");
    expect(result.workspaceDir).toBe(path.resolve(fallbackWorkspace));
  });

  it("uses the robot own space for an employee session, not employees leftover", () => {
    const stateDir = path.join(process.cwd(), "tmp", "workspace-run-employee-state");
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const result = resolveRunWorkspaceDir({
        workspaceDir: undefined,
        sessionKey: "agent:main:employee:user-elle",
        config: {
          agents: { list: [{ id: "main", workspace: "/tmp/should-not-use" }] },
        },
      });
      expect(result.workspaceDir).toBe(
        path.resolve(stateDir, "tenants/001/users/user-elle/OpenBot/agents/main/workspace"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("writes user A into A's space when the requested dir is user B", () => {
    const stateDir = path.join(process.cwd(), "tmp", "workspace-run-two-users");
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const userB = path.join(
        stateDir,
        "tenants",
        "001",
        "users",
        "user-b",
        "OpenBot",
        "agents",
        "agt-hr",
        "workspace",
      );
      const result = resolveRunWorkspaceDir({
        workspaceDir: userB,
        sessionKey: "agent:agt-hr:main",
        agentId: "agt-hr",
        userId: "user-a",
        tenantId: "001",
      });
      expect(result.workspaceDir).toBe(
        path.resolve(stateDir, "tenants/001/users/user-a/OpenBot/agents/agt-hr/workspace"),
      );
      expect(result.workspaceDir).not.toContain("user-b");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps a Path B operators remount for the same user and agent", () => {
    const stateDir = path.join(process.cwd(), "tmp", "workspace-run-operators");
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    const operators = path.join(
      stateDir,
      "operators",
      "user-a",
      "OpenBot",
      "agents",
      "agt-hr",
      "workspace",
    );
    fs.mkdirSync(operators, { recursive: true });
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const result = resolveRunWorkspaceDir({
        workspaceDir: operators,
        sessionKey: "agent:agt-hr:main",
        agentId: "agt-hr",
        userId: "user-a",
        tenantId: "001",
      });
      expect(result.workspaceDir).toBe(path.resolve(operators));
      expect(result.usedFallback).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("relocates a tenants twin onto operators under shared addressing", () => {
    const root = path.join(process.cwd(), "tmp", "workspace-run-shared-align");
    const tenantsRoot = path.join(root, "tenants");
    const stateDir = path.join(root, "state");
    const tenantsWs = path.join(
      tenantsRoot,
      "001",
      "users",
      "user-a",
      "OpenBot",
      "agents",
      "agt-hr",
      "workspace",
    );
    const operatorsWs = path.join(
      stateDir,
      "operators",
      "user-a",
      "OpenBot",
      "agents",
      "agt-hr",
      "workspace",
    );
    fs.mkdirSync(tenantsWs, { recursive: true });
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    const previous = {
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
      OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
      OPENBOT_MULTITENANT: process.env.OPENBOT_MULTITENANT,
      OPENBOT_DATA_MODE: process.env.OPENBOT_DATA_MODE,
    };
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_DATA_MODE = "managed";
    try {
      const result = resolveRunWorkspaceDir({
        workspaceDir: tenantsWs,
        sessionKey: "agent:agt-hr:main",
        agentId: "agt-hr",
        userId: "user-a",
        tenantId: "001",
        config: { data: { mode: "managed" } },
      });
      expect(result.workspaceDir).toBe(path.resolve(operatorsWs));
      expect(result.workspaceDir).not.toBe(path.resolve(tenantsWs));
      expect(result.usedFallback).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a polluting host workspaceDir when the employee identity is known", () => {
    const stateDir = path.join(process.cwd(), "tmp", "workspace-run-ignore-host");
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const result = resolveRunWorkspaceDir({
        workspaceDir: path.join(stateDir, "workspace-main"),
        sessionKey: "agent:main:employee:user-elle",
      });
      expect(result.workspaceDir).toBe(
        path.resolve(stateDir, "tenants/001/users/user-elle/OpenBot/agents/main/workspace"),
      );
      expect(result.usedFallback).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("seat formal root: chatting user operators remount does not override sticky host", () => {
    const stateDir = path.join(process.cwd(), "tmp", "workspace-run-seat-sticky");
    const sticky = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "agt-contract",
    });
    fs.mkdirSync(sticky, { recursive: true });
    const ceoOperators = path.join(
      stateDir,
      "operators",
      "user-ceo",
      "OpenBot",
      "agents",
      "agt-contract",
      "workspace",
    );
    fs.mkdirSync(ceoOperators, { recursive: true });
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = stateDir;
    try {
      const result = resolveRunWorkspaceDir({
        workspaceDir: ceoOperators,
        sessionKey: "agent:agt-contract:main",
        agentId: "agt-contract",
        userId: "user-ceo",
        tenantId: "001",
        writeOwnership: seatOwnedWriteOwnership({
          seatId: "seat-cs",
          stickyLocator: sticky,
        }),
      });
      expect(result.workspaceDir).toBe(path.resolve(sticky));
      expect(result.workspaceDir).not.toBe(path.resolve(ceoOperators));
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("seat formal root: missing sticky/host throws (no chatting-user fallback)", () => {
    expect(() =>
      resolveRunWorkspaceDir({
        workspaceDir: "/tmp/whatever",
        sessionKey: "agent:agt-contract:main",
        agentId: "agt-contract",
        userId: "user-ceo",
        tenantId: "001",
        writeOwnership: seatOwnedWriteOwnership({ seatId: "seat-cs" }),
      }),
    ).toThrow(/seat formal root missing sticky\/host binding/);
  });
});
