import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageSandboxMedia } from "../../auto-reply/reply/stage-sandbox-media.js";
import type { OpenBotConfig } from "../../config/config.js";
import { ensureSandboxWorkspaceForSession } from "./context.js";

const envKeys = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
] as const;
const previousEnv = new Map<string, string | undefined>();

function sandboxCfg(): OpenBotConfig {
  return {
    data: { mode: "managed" },
    agents: {
      defaults: {
        sandbox: { mode: "all", scope: "session" },
      },
      list: [{ id: "bot" }],
    },
  };
}

afterEach(async () => {
  for (const key of envKeys) {
    const previous = previousEnv.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  previousEnv.clear();
});

function enableManagedMultitenant(tenantsRoot: string) {
  for (const key of envKeys) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.OPENBOT_DATA_MODE = "managed";
  process.env.OPENBOT_MULTITENANT = "1";
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  process.env.OPENBOT_STATE_DIR = path.join(path.dirname(tenantsRoot), "operator-state");
}

describe("ensureSandboxWorkspaceForSession account layout", () => {
  it("fails closed under managed multitenant when the account is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-ws-"));
    enableManagedMultitenant(path.join(root, "tenants"));
    const legacy = path.join(root, "legacy-workspace");
    await fs.mkdir(legacy, { recursive: true });
    await expect(
      ensureSandboxWorkspaceForSession({
        config: sandboxCfg(),
        sessionKey: "agent:bot:turn-1",
        workspaceDir: legacy,
      }),
    ).rejects.toThrow(/server-derived account/);
    await expect(fs.access(path.join(legacy, "media"))).rejects.toThrow();
  });

  it("stages inbound media into the account agent workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-stage-"));
    const tenantsRoot = path.join(root, "tenants");
    enableManagedMultitenant(tenantsRoot);
    const stateDir = process.env.OPENBOT_STATE_DIR ?? "";
    const legacy = path.join(root, "legacy-workspace");
    await fs.mkdir(legacy, { recursive: true });
    const cfg = sandboxCfg();
    await stageSandboxMedia({
      ctx: {
        MediaPath: path.join(root, "outside-media.png"),
        GatewayClientUser: "user-a",
        GatewayClientSessionEnterpriseId: "tenant-a",
      },
      sessionCtx: {},
      cfg,
      sessionKey: "agent:bot:turn-1",
      workspaceDir: legacy,
    });
    const accountWorkspace = path.join(
      stateDir,
      "operators",
      "user-a",
      "OpenBot",
      "agents",
      "bot",
      "workspace",
    );
    const stat = await fs.stat(accountWorkspace);
    expect(stat.isDirectory()).toBe(true);
    await expect(fs.access(path.join(legacy, "media"))).rejects.toThrow();
    const resolved = await ensureSandboxWorkspaceForSession({
      config: cfg,
      sessionKey: "agent:bot:turn-1",
      workspaceDir: legacy,
      account: { tenantId: "tenant-a", userId: "user-a" },
    });
    expect(resolved?.workspaceDir).toBe(accountWorkspace);
    expect(resolved?.workspaceDir).not.toBe(legacy);
    expect(resolved?.containerWorkdir).toBe("/account/workspace");
  });
});
