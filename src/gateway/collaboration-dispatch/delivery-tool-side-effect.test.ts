/**
 * Residual B: the embedded tool loop claims durable side effects.
 * A second execute with the same task/step/tool fingerprint must skip.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { splitSdkTools } from "../../agents/pi-embedded-runner/tool-split.js";
import { assembleCollaborationRuntimeContextParts } from "../../auto-reply/reply/runtime-context-assembly.js";
import type { TemplateContext } from "../../auto-reply/templating.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenBotConfig } from "../../config/types.js";
import { GROUP_PUBLIC_TRANSCRIPT_RELATIVE_PATH } from "../collaboration-learning/collaboration-paths.js";
import {
  isSideEffectingDeliveryTool,
  resolveDeliveryToolSideEffectLedgerDir,
} from "./delivery-tool-side-effect.js";
import { createCollaborationPrivateRunBag } from "./private-run-bag.js";
import { isCollabRuntimeNamespaceEnabled } from "./runtime-namespace.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function tool(
  name: string,
  run: () => Promise<AgentToolResult<unknown>> | AgentToolResult<unknown>,
): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => await run(),
  };
}

type ToolExecute = ReturnType<typeof splitSdkTools>["customTools"][number]["execute"];
const extensionContext = {} as Parameters<ToolExecute>[4];

async function execute(def: { execute: ToolExecute }, callId: string) {
  return await def.execute(callId, {}, undefined, undefined, extensionContext);
}

describe("delivery tool side effect loop", () => {
  it("classifies side-effecting delivery tools and leaves reads alone", () => {
    expect(isSideEffectingDeliveryTool("message")).toBe(true);
    expect(isSideEffectingDeliveryTool("bash")).toBe(true);
    expect(isSideEffectingDeliveryTool("read")).toBe(false);
    expect(isSideEffectingDeliveryTool("weather")).toBe(false);
  });

  it("keeps the ledger off GROUP_PUBLIC when runtimeNamespace stays off", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-side-effect-dir-"));
    tempDirs.push(root);
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "personal_local" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
      },
    } as OpenBotConfig;
    expect(isCollabRuntimeNamespaceEnabled(cfg)).toBe(false);
    const ledgerDir = resolveDeliveryToolSideEffectLedgerDir({ groupId: "grp-dedupe", cfg });
    expect(ledgerDir.endsWith(`${path.sep}tool-side-effects`)).toBe(true);
    expect(ledgerDir).not.toContain(GROUP_PUBLIC_TRANSCRIPT_RELATIVE_PATH);
  });

  it("splitSdkTools invokes the scheduler and skips a second identical fingerprint", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-loop-side-effect-"));
    tempDirs.push(ledgerDir);
    const schedule = {
      ledgerDir,
      taskId: "task-1",
      boardItemId: "item-1",
      stepId: "step-1",
    };
    let messageCalls = 0;
    let readCalls = 0;
    let bashCalls = 0;
    const { customTools } = splitSdkTools({
      tools: [
        tool("message", () => {
          messageCalls += 1;
          return {
            content: [{ type: "text", text: "sent" }],
            details: { status: "ok" },
          };
        }),
        tool("read", () => {
          readCalls += 1;
          return {
            content: [{ type: "text", text: "file" }],
            details: { status: "ok" },
          };
        }),
        tool("bash", () => {
          bashCalls += 1;
          return {
            content: [{ type: "text", text: "ran" }],
            details: { status: "ok" },
          };
        }),
      ],
      sandboxEnabled: false,
      deliveryToolSideEffect: schedule,
    });
    const message = customTools.find((entry) => entry.name === "message");
    const read = customTools.find((entry) => entry.name === "read");
    const bash = customTools.find((entry) => entry.name === "bash");
    if (!message || !read || !bash) {
      throw new Error("missing tool definitions");
    }

    const first = await execute(message, "m1");
    const second = await execute(message, "m2");
    expect(messageCalls).toBe(1);
    expect(first.details).toMatchObject({ status: "ok" });
    expect(second.details).toMatchObject({
      status: "skipped",
      tool: "message",
      reason: "durable_side_effect_already_claimed",
      key: "task-1|item-1|step-1|message",
    });

    await execute(read, "r1");
    await execute(read, "r2");
    expect(readCalls).toBe(2);

    await execute(bash, "b1");
    const execAgain = customTools.find((entry) => entry.name === "bash");
    if (!execAgain) {
      throw new Error("missing bash");
    }
    const skippedExec = await execute(execAgain, "b2");
    expect(bashCalls).toBe(1);
    expect(skippedExec.details).toMatchObject({
      status: "skipped",
      key: "task-1|item-1|step-1|exec",
    });

    const files = await fs.readdir(ledgerDir);
    expect(files.length).toBeGreaterThan(0);
    const bodies = await Promise.all(
      files.map(async (name) => await fs.readFile(path.join(ledgerDir, name), "utf8")),
    );
    expect(bodies.some((body) => body.includes('"key":"task-1|item-1|step-1|message"'))).toBe(true);
    expect(bodies.join("\n")).not.toContain("transcript.jsonl");
  });

  it("does not claim a ledger when the turn has no delivery fingerprint", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-loop-plain-"));
    tempDirs.push(ledgerDir);
    let calls = 0;
    const { customTools } = splitSdkTools({
      tools: [
        tool("message", () => {
          calls += 1;
          return { content: [{ type: "text", text: "sent" }], details: { status: "ok" } };
        }),
      ],
      sandboxEnabled: false,
    });
    const message = customTools[0];
    if (!message) {
      throw new Error("missing message");
    }
    await execute(message, "m1");
    await execute(message, "m2");
    expect(calls).toBe(2);
    expect(await fs.readdir(ledgerDir)).toEqual([]);
  });

  it("a failed side effect stays claimed so the loop does not re-fire it", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-loop-fail-"));
    tempDirs.push(ledgerDir);
    let calls = 0;
    const { customTools } = splitSdkTools({
      tools: [
        tool("message", () => {
          calls += 1;
          throw new Error("send failed");
        }),
      ],
      sandboxEnabled: false,
      deliveryToolSideEffect: {
        ledgerDir,
        taskId: "task-1",
        boardItemId: "item-1",
        stepId: "step-1",
      },
    });
    const message = customTools[0];
    if (!message) {
      throw new Error("missing message");
    }
    const failed = await execute(message, "m1");
    const skipped = await execute(message, "m2");
    expect(calls).toBe(1);
    expect(failed.details).toMatchObject({ status: "error", error: "send failed" });
    expect(skipped.details).toMatchObject({
      status: "waiting",
      retryAllowed: false,
      waitCondition: { reason: "external_operation" },
    });
  });

  it("indexes the private run bag once and never double-fires the same fingerprint", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-loop-bag-"));
    tempDirs.push(ledgerDir);
    const bag = createCollaborationPrivateRunBag({ agentId: "bot-residual-b" });
    let calls = 0;
    const { customTools } = splitSdkTools({
      tools: [
        tool("message", () => {
          calls += 1;
          return { content: [{ type: "text", text: "sent" }], details: { status: "ok" } };
        }),
      ],
      sandboxEnabled: false,
      deliveryToolSideEffect: {
        ledgerDir,
        taskId: "task-bag",
        boardItemId: "item-bag",
        stepId: "step-bag",
      },
      privateRunBag: bag,
    });
    const message = customTools[0];
    if (!message) {
      throw new Error("missing message");
    }
    await execute(message, "m1");
    await execute(message, "m2");
    expect(calls).toBe(1);
    expect(bag.toolSideEffectIndex).toHaveLength(1);
    expect(bag.toolSideEffectIndex[0]?.toolName).toBe("message");
  });
});

describe("Residual B production call-site regression", () => {
  it("keeps toToolDefinitions claiming via runDeliveryToolSideEffect → scheduleDurableToolSideEffect", () => {
    const adapter = fsSync.readFileSync(
      path.join(process.cwd(), "src/agents/pi-tool-definition-adapter.ts"),
      "utf8",
    );
    const choke = fsSync.readFileSync(
      path.join(process.cwd(), "src/gateway/collaboration-dispatch/delivery-tool-side-effect.ts"),
      "utf8",
    );
    const attempt = fsSync.readFileSync(
      path.join(process.cwd(), "src/agent-runtime/execution/runner/embedded-attempt-session.ts"),
      "utf8",
    );
    expect(adapter).toContain("runDeliveryToolSideEffect");
    expect(adapter).toContain("options?.deliveryToolSideEffect");
    expect(adapter).toContain("options?.privateRunBag");
    expect(choke).toContain("scheduleDurableToolSideEffect");
    expect(attempt).toContain("deliveryToolSideEffect: params.deliveryToolSideEffect");
    expect(attempt).toContain("privateRunBag: params.privateRunBag");
  });
});

describe("delivery fingerprint reaches the tool loop from prompt assembly", () => {
  const GROUP_ID = "grp_loop";
  const TASK_ID = "task_loop";
  const savedStateDir = process.env.OPENBOT_STATE_DIR;
  const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
  const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

  afterEach(() => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    if (savedStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = savedStateDir;
    }
    if (savedOpenbotConfigPath === undefined) {
      delete process.env.OPENBOT_CONFIG_PATH;
    } else {
      process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
    }
    if (savedOpenclawConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
    }
  });

  async function useConfig(claimContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-loop-assembly-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "personal_local" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: false,
        task: { claimContract },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();
    return { root, cfg };
  }

  it("claim off does not attach a delivery fingerprint", async () => {
    const { root, cfg } = await useConfig(false);
    const sessionCtx = {
      CollaborationGroupId: GROUP_ID,
      CollaborationBotAgentId: "bot-analyst",
      CollaborationRoundInvoked: true,
      Provider: "webchat",
    } as TemplateContext;
    await assembleCollaborationRuntimeContextParts({
      cfg,
      workspaceDir: path.join(root, "agent-ws"),
      agentId: "bot-analyst",
      sessionKey: "agent:bot-analyst:group",
      sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
      sessionCtx,
      isNewSession: false,
      shouldInjectGroupIntro: false,
      defaultActivation: "mention",
      silentToken: "NO_REPLY",
    });
    expect(sessionCtx.DeliveryToolSideEffect).toBeUndefined();
    expect(cfg.collaboration?.runtimeNamespace).toBe(false);
  });

  it("a confirmed delivery step's fingerprint is what splitSdkTools dedupes", async () => {
    const { root, cfg } = await useConfig(true);
    const { createRoundPolicySnapshot } = await import("./round-policy-snapshot.js");
    const { createRuntimeAuthority } = await import("./runtime-authority.js");
    const { publishBoardItem, claimBoardItem, applyClaim, markBoardItemInProgress } =
      await import("./claim-contract.js");
    const { proposeTodolist, confirmTodolist } = await import("./executor-private-todolist.js");
    const snapshot = createRoundPolicySnapshot(
      {
        collaborationMode: "task_driven",
        finalDecisionMode: "human_required",
        botMaySelfAdvanceWithoutHuman: false,
      },
      { now: 1, idGen: () => "pss_loop" },
    );
    const auth = createRuntimeAuthority({
      snapshot,
      episodeId: "ep_loop",
      tenant: { tenantId: null, trust: "none" },
      groupId: GROUP_ID,
      profile: "personal_local",
      cfg,
    });
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP_ID,
        taskId: TASK_ID,
        remainingWork: "交付去重",
        acceptanceCriteria: ["一次"],
        goal: "交付去重",
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-lead",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(auth, { taskId: TASK_ID, itemId, claimantId: "bot-analyst" }, { cfg });
    await applyClaim(
      auth,
      { taskId: TASK_ID, itemId },
      { taskId: TASK_ID, title: "loop", status: "open" } as never,
      auth.policy.effective,
      { cfg },
    );
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: TASK_ID,
        groupId: GROUP_ID,
        ownerMemberId: "bot-analyst",
        steps: [{ title: "发送一次", stepId: "step-send" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: TASK_ID,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-lead",
      },
      { cfg, authorizedConfirmerIds: ["bot-lead"] },
    );
    expect(confirmed.ok).toBe(true);
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: TASK_ID, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);

    const sessionCtx = {
      CollaborationGroupId: GROUP_ID,
      CollaborationBotAgentId: "bot-analyst",
      CollaborationRoundInvoked: true,
      Provider: "webchat",
    } as TemplateContext;
    await assembleCollaborationRuntimeContextParts({
      cfg,
      workspaceDir: path.join(root, "agent-ws"),
      agentId: "bot-analyst",
      sessionKey: "agent:bot-analyst:group",
      sessionEntry: { sessionId: "bot-private", updatedAt: 1 } as SessionEntry,
      sessionCtx,
      isNewSession: false,
      shouldInjectGroupIntro: false,
      defaultActivation: "mention",
      silentToken: "NO_REPLY",
    });
    const schedule = sessionCtx.DeliveryToolSideEffect;
    expect(schedule?.taskId).toBe(TASK_ID);
    expect(schedule?.boardItemId).toBe(itemId);
    expect(schedule?.stepId).toBe("step-send");
    expect(schedule?.ledgerDir.endsWith(`${path.sep}tool-side-effects`)).toBe(true);
    expect(schedule?.ledgerDir).not.toContain(GROUP_PUBLIC_TRANSCRIPT_RELATIVE_PATH);
    expect(cfg.collaboration?.runtimeNamespace).toBe(false);

    let calls = 0;
    const { customTools } = splitSdkTools({
      tools: [
        tool("message", () => {
          calls += 1;
          return { content: [{ type: "text", text: "sent" }], details: { status: "ok" } };
        }),
      ],
      sandboxEnabled: false,
      deliveryToolSideEffect: schedule,
      cfg,
    });
    const message = customTools[0];
    if (!message) {
      throw new Error("missing message");
    }
    await execute(message, "m1");
    const skipped = await execute(message, "m2");
    expect(calls).toBe(1);
    expect(skipped.details).toMatchObject({
      status: "skipped",
      key: `${TASK_ID}|${itemId}|step-send|message`,
    });
  });
});

it("carries canonical admitted operation identity through the actual SDK tool chain", async () => {
  const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "canonical-operation-chain-"));
  tempDirs.push(ledgerDir);
  const operationIdentity = {
    tenantId: "tenant",
    taskId: "task",
    executionId: "chat:execution",
    stepId: "step",
    operationId: "send",
  };
  let writes = 0;
  const schedule = {
    ledgerDir,
    taskId: "task",
    boardItemId: "item",
    stepId: "step",
    operationIdentity,
  };
  const tools = splitSdkTools({
    sandboxEnabled: false,
    deliveryToolSideEffect: schedule,
    tools: [
      tool("message", () => {
        writes += 1;
        return { content: [{ type: "text", text: "sent" }], details: { status: "ok" } };
      }),
    ],
  }).customTools;
  await execute(tools[0], "first-attempt-call");
  await execute(tools[0], "retry-different-call");
  expect(writes).toBe(1);
  const claims = (await fs.readdir(ledgerDir)).filter((name) => name.endsWith(".json"));
  expect(claims).toHaveLength(1);
  const claim = JSON.parse(await fs.readFile(path.join(ledgerDir, claims[0]), "utf8"));
  expect(claim.key).toMatch(/^operation:v1:[a-f0-9]{64}$/);
});
