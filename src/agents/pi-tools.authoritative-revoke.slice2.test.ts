import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAuthStore } from "../gateway/platform-auth/store-types.js";
import { createDefaultPolicy } from "../gateway/platform-auth/trial-policy.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import type { InboundToolCeiling } from "./inbound-tool-policy.js";
import { ToolAuthorizationError } from "./tools/common.js";
import { decideWriteSideRetry, WRITE_SIDE_OUTCOME_UNKNOWN } from "./write-side-retry-gate.js";

/**
 * WP-B slice 2: mid-execution authority revoke on the production
 * createOpenClawCodingTools path. Tools are constructed by the real factory
 * (including createChatSendWriteAuthorityRecheck). Writes go through the real
 * `write` tool into an isolated temp workspace; authority is a real platform-auth
 * JSON store that resolveAuthoritativeMembership re-reads live via
 * loadPlatformAuthStore. Unknown-result integration uses the real write and
 * factory wrappers through splitSdkTools/adapter; a fault fixture returns
 * result_unknown after the real write. This does not exercise retry schedulers
 * or crash replay. The separate decideWriteSideRetry case remains helper-only.
 */

const hookPause = vi.hoisted(() => ({
  handler: undefined as
    | undefined
    | (() => Promise<
        { block?: boolean; blockReason?: string; params?: Record<string, unknown> } | undefined
      >),
}));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () =>
    hookPause.handler
      ? {
          hasHooks: (name: string) => name === "before_tool_call",
          runBeforeToolCall: () => hookPause.handler!(),
        }
      : null,
}));
const unknownWrite = vi.hoisted(() => ({ enabled: false, effects: 0 }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createWriteTool: (...args: Parameters<typeof actual.createWriteTool>) => {
      const tool = actual.createWriteTool(...args);
      const execute = tool.execute.bind(tool);
      return {
        ...tool,
        execute: async (...call: Parameters<typeof tool.execute>) => {
          const result = await execute(...call);
          if (!unknownWrite.enabled) {
            return result;
          }
          unknownWrite.effects++;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ status: "result_unknown" }) },
            ],
            details: { status: "result_unknown" },
          };
        },
      };
    },
  };
});
const { splitSdkTools } = await import("./pi-embedded-runner/tool-split.js");

let currentStorePath = "";

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({
    gateway: {
      auth: {
        trustedProxy: {
          platformAuth: {
            enabled: true,
            store: currentStorePath,
          },
        },
      },
    },
  }),
}));

const { createOpenClawCodingTools } = await import("./pi-tools.js");
const { resolveAuthoritativeMembership } = await import("../gateway/tenant-context.js");
const { loadConfig } = await import("../config/config.js");

const NOW = "2026-01-01T00:00:00.000Z";
const USER_EMAIL = "multi@example.com";
const USER_ID = "user-multi";
const ENT_A = "ent-a";
const MEM_A = "mem-a";

const ACT_CEILING: InboundToolCeiling = {
  depth: "act",
  maxToolMode: "write",
  maxSideEffectLevel: "irreversible_external",
};

function grantedStore(): PlatformAuthStore {
  return {
    version: 5,
    secret: "slice2-test-secret",
    policy: createDefaultPolicy(NOW),
    enterprises: {
      [ENT_A]: {
        id: ENT_A,
        name: "A",
        slug: "ent-a",
        status: "paid",
        plan: "paid",
        createdSource: "self-service",
        billingStatus: "active",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 5,
        seatUsed: 1,
      },
    },
    users: {
      [USER_ID]: {
        id: USER_ID,
        email: USER_EMAIL,
        normalizedEmail: USER_EMAIL,
        displayName: "Multi",
        passwordHash: "x",
        passwordUpdatedAt: NOW,
        loginFailedCount: 0,
        status: "active",
        source: "self-created",
        role: "operator",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    sessions: {},
    memberships: {
      [MEM_A]: {
        id: MEM_A,
        userId: USER_ID,
        enterpriseId: ENT_A,
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
}

function revokedStore(): PlatformAuthStore {
  const store = grantedStore();
  store.memberships = {};
  store.enterprises[ENT_A] = { ...store.enterprises[ENT_A], seatUsed: 0 };
  return store;
}

async function writeAuthStore(store: PlatformAuthStore): Promise<void> {
  await fs.writeFile(currentStorePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

const boundIdentity = {
  user: USER_EMAIL,
  platformUserId: USER_ID,
  sessionDomain: "enterprise" as const,
  enterpriseId: ENT_A,
  membershipId: MEM_A,
};

async function expectLiveMembership(granted: boolean): Promise<void> {
  expect(loadConfig().gateway?.auth?.trustedProxy?.platformAuth?.store).toBe(currentStorePath);
  await expect(
    resolveAuthoritativeMembership({
      user: USER_EMAIL,
      platformUserId: USER_ID,
      sessionDomain: "enterprise",
      sessionEnterpriseId: ENT_A,
      sessionMembershipId: MEM_A,
    } as GatewayClient),
  ).resolves.toEqual(
    granted ? { tenantId: ENT_A, userId: USER_ID } : { tenantId: null, userId: USER_ID },
  );
}

async function countedWorkspaceFiles(workspaceDir: string): Promise<number> {
  const entries = await fs.readdir(workspaceDir);
  return entries.length;
}

function createCodingTools(
  workspaceDir: string,
  opts?: { inboundToolCeiling?: InboundToolCeiling; bindEnterprise?: boolean },
) {
  const bindEnterprise = opts?.bindEnterprise ?? true;
  return createOpenClawCodingTools({
    workspaceDir,
    forceWorkspaceOnly: true,
    disableMessageTool: true,
    agentId: "slice2-agent",
    sessionId: "slice2-session",
    sessionKey: "agent:slice2:main",
    runId: "slice2-run",
    config: { tools: { fs: { workspaceOnly: true } } },
    inboundToolCeiling: opts?.inboundToolCeiling,
    ...(bindEnterprise
      ? {
          executionIdentity: boundIdentity,
          gatewayClientUser: boundIdentity.user,
          gatewayClientPlatformUserId: boundIdentity.platformUserId,
          gatewayClientSessionDomain: boundIdentity.sessionDomain,
          gatewayClientSessionEnterpriseId: boundIdentity.enterpriseId,
          gatewayClientSessionMembershipId: boundIdentity.membershipId,
        }
      : {}),
  });
}

function requireTool(tools: ReturnType<typeof createOpenClawCodingTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool?.execute) {
    throw new Error(`missing ${name} tool from createOpenClawCodingTools`);
  }
  return tool;
}

async function executeWrite(
  tool: { execute: (...args: never[]) => Promise<unknown> },
  callId: string,
  fileName: string,
  content: string,
) {
  return tool.execute(callId as never, { path: fileName, content } as never);
}

describe("WP-B slice 2: revoke after start blocks the next chat.send write", () => {
  let workspaceDir: string;
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wpb-slice2-auth-"));
    currentStorePath = path.join(storeDir, "openbot-platform-auth.json");
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wpb-slice2-ws-"));
    await writeAuthStore(grantedStore());
  });

  afterEach(async () => {
    hookPause.handler = undefined;
    unknownWrite.enabled = false;
    unknownWrite.effects = 0;
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  it("unrevoked control still performs the next external write", async () => {
    const tools = createCodingTools(workspaceDir);
    const writeTool = requireTool(tools, "write");
    await expectLiveMembership(true);

    await executeWrite(writeTool, "call-1", "out-1.txt", "one");
    expect(await fs.readFile(path.join(workspaceDir, "out-1.txt"), "utf8")).toBe("one");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);

    await executeWrite(writeTool, "call-2", "out-2.txt", "two");
    expect(await fs.readFile(path.join(workspaceDir, "out-2.txt"), "utf8")).toBe("two");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(2);
  });

  it("revoking authority after the first write blocks the next write", async () => {
    const tools = createCodingTools(workspaceDir);
    const writeTool = requireTool(tools, "write");
    await expectLiveMembership(true);

    await executeWrite(writeTool, "call-1", "out-1.txt", "one");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);

    await writeAuthStore(revokedStore());
    await expectLiveMembership(false);
    await expect(executeWrite(writeTool, "call-2", "out-2.txt", "two")).rejects.toBeInstanceOf(
      ToolAuthorizationError,
    );

    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);
    await expect(fs.stat(path.join(workspaceDir, "out-2.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("frozen inbound ceiling snapshot still blocks the next write after revoke", async () => {
    const tools = createCodingTools(workspaceDir, { inboundToolCeiling: ACT_CEILING });
    const writeTool = requireTool(tools, "write");
    await expectLiveMembership(true);

    await executeWrite(writeTool, "call-1", "out-1.txt", "one");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);

    await writeAuthStore(revokedStore());
    await expectLiveMembership(false);
    await expect(executeWrite(writeTool, "call-2", "out-2.txt", "two")).rejects.toBeInstanceOf(
      ToolAuthorizationError,
    );

    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);
    await expect(fs.stat(path.join(workspaceDir, "out-2.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("non-enterprise writes are not blanket-denied after membership is revoked", async () => {
    const tools = createCodingTools(workspaceDir, { bindEnterprise: false });
    const writeTool = requireTool(tools, "write");

    await executeWrite(writeTool, "call-1", "out-1.txt", "one");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);

    await writeAuthStore(revokedStore());
    await executeWrite(writeTool, "call-2", "out-2.txt", "two");

    expect(await fs.readFile(path.join(workspaceDir, "out-2.txt"), "utf8")).toBe("two");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(2);
  });

  it("revoke does not recode an already-issued unknown write as failed or ok", () => {
    // Existing coverage of decideWriteSideRetry only; not wrapper integration evidence.
    const recorded = { status: WRITE_SIDE_OUTCOME_UNKNOWN };
    const afterRevoke = decideWriteSideRetry({
      sideEffectLevel: "reversible",
      outcomeStatus: recorded.status,
    });
    expect(afterRevoke.status).toBe(WRITE_SIDE_OUTCOME_UNKNOWN);
    expect(afterRevoke.status).not.toBe("failed");
    expect(afterRevoke.status).not.toBe("ok");
    expect(afterRevoke.allowAutomaticRetry).toBe(false);
  });

  it("preserves an issued unknown write through factory wrappers and SDK adapter without replay", async () => {
    unknownWrite.enabled = true;
    const tools = createCodingTools(workspaceDir);
    const sdk = splitSdkTools({ tools, sandboxEnabled: false });
    const write = sdk.customTools.find((tool) => tool.name === "write")!;
    const first = await write.execute(
      "sdk-unknown-1",
      { path: "issued.txt", content: "issued-once" },
      undefined,
      undefined,
      {} as never,
    );
    expect(await fs.readFile(path.join(workspaceDir, "issued.txt"), "utf8")).toBe("issued-once");
    expect(first.details).toMatchObject({ status: "result_unknown" });
    await writeAuthStore(revokedStore());
    await expectLiveMembership(false);
    expect(first.details).toMatchObject({ status: "result_unknown" });
    const second = await write.execute(
      "sdk-after-revoke",
      { path: "second.txt", content: "must-not-write" },
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.stringify(second)).toContain("authority_revoked");
    expect(unknownWrite.effects).toBe(1);
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);
    expect(first.details).toMatchObject({ status: "result_unknown" });
  });

  it.each([false, true])(
    "blocks a write revoked during awaited hook (ceiling=%s)",
    async (ceiling) => {
      unknownWrite.enabled = true;
      let entered!: () => void;
      let resume!: () => void;
      const atHook = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        resume = resolve;
      });
      hookPause.handler = async () => {
        entered();
        await barrier;
        return undefined;
      };
      const tools = createCodingTools(workspaceDir, {
        inboundToolCeiling: ceiling ? ACT_CEILING : undefined,
      });
      const sdk = splitSdkTools({ tools, sandboxEnabled: false });
      const write = sdk.customTools.find((tool) => tool.name === "write")!;
      const pending = write.execute(
        "hook-revoke-window",
        { path: "hook-window.txt", content: "effect-after-revoke" },
        undefined,
        undefined,
        {} as never,
      );
      await atHook;
      await writeAuthStore(revokedStore());
      await expectLiveMembership(false);
      resume();
      const result = await pending;
      const files = await countedWorkspaceFiles(workspaceDir);
      console.log(
        "H_W1_EFFECT",
        JSON.stringify({ ceiling, files, effects: unknownWrite.effects, authorityGranted: false }),
      );
      expect(JSON.stringify(result)).toContain("authority_revoked");
      await expect(fs.stat(path.join(workspaceDir, "hook-window.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(files).toBe(0);
      expect(unknownWrite.effects).toBe(0);
    },
  );

  it("preserves allowed hook parameter adjustment and hook blocking", async () => {
    hookPause.handler = async () => ({ params: { path: "adjusted.txt", content: "adjusted" } });
    const tools = createCodingTools(workspaceDir);
    const write = splitSdkTools({ tools, sandboxEnabled: false }).customTools.find(
      (tool) => tool.name === "write",
    )!;
    await write.execute(
      "hook-adjust",
      { path: "original.txt", content: "original" },
      undefined,
      undefined,
      {} as never,
    );
    expect(await fs.readFile(path.join(workspaceDir, "adjusted.txt"), "utf8")).toBe("adjusted");
    await expect(fs.stat(path.join(workspaceDir, "original.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    hookPause.handler = async () => ({ block: true, blockReason: "fixture_block" });
    const blocked = await write.execute(
      "hook-block",
      { path: "blocked.txt", content: "blocked" },
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.stringify(blocked)).toContain("fixture_block");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);
  });

  it("honors cancellation accepted while hook is paused", async () => {
    const controller = new AbortController();
    hookPause.handler = async () => {
      controller.abort();
      return undefined;
    };
    const write = splitSdkTools({
      tools: createCodingTools(workspaceDir),
      sandboxEnabled: false,
    }).customTools.find((tool) => tool.name === "write")!;
    await expect(
      write.execute(
        "hook-abort",
        { path: "aborted.txt", content: "no" },
        controller.signal,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow();
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(0);
  });

  it("read-only tools still execute after authority is revoked", async () => {
    const tools = createCodingTools(workspaceDir);
    const writeTool = requireTool(tools, "write");
    const readTool = requireTool(tools, "read");

    await expectLiveMembership(true);
    await executeWrite(writeTool, "call-1", "out-1.txt", "one");
    await writeAuthStore(revokedStore());
    await expectLiveMembership(false);

    const result = await readTool.execute("call-2", { path: "out-1.txt" });
    const text =
      result &&
      typeof result === "object" &&
      Array.isArray((result as { content?: unknown }).content)
        ? ((result as { content: Array<{ type?: string; text?: string }> }).content.find(
            (block) => block.type === "text",
          )?.text ?? "")
        : "";
    expect(text).toContain("one");
    expect(await countedWorkspaceFiles(workspaceDir)).toBe(1);
  });
});
