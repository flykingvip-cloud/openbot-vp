import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionContext,
  ModelRegistry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLogicalArtifact,
  collectCollectorTexts,
  gitPorcelain,
  isTrackedSummaryPath,
  resolveRepoRoot,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/artifact.ts";
import { sha256Hex } from "../../../../.kiro/specs/execution-router-phase0/shadow/ids.ts";
import {
  buildShadowSummary,
  toShadowSample,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/summarize.ts";
import type {
  ShadowCategory,
  ShadowSample,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/types.ts";
import {
  recomputeShadowMetrics,
  validateShadowSummary,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/validate.ts";
import { emitChatInboundStage } from "../../../gateway/chat-inbound-stage-events.js";
import {
  configureExecutionRouterObservationForTest,
  executionRouterObservationSize,
  peekExecutionRouterObservation,
  resetExecutionRouterObservationForTest,
  type ChatRunObservation,
} from "../../../gateway/execution-router-observation.js";
import type { ConstitutionalRuntimeShadowDeps } from "../../execution-preflight/constitutional-runtime-shadow-deps.js";
import { NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK } from "../../execution-preflight/constitutional-runtime-shadow-sink.js";
import type { OpenBotAuthStorage } from "../../pi-sdk/auth-storage.js";

const hoisted = vi.hoisted(() => {
  const createAgentSessionMock = vi.fn();
  const sessionManagerOpenMock = vi.fn();
  const resolveSandboxContextMock = vi.fn();
  const subscribeEmbeddedPiSessionMock = vi.fn();
  const acquireSessionWriteLockMock = vi.fn();
  const codingTools: AgentTool[] = [];
  const sessionManager = {
    getHeader: vi.fn(() => ({ type: "session", id: "shadow-session", version: 1 })),
    getLeafEntry: vi.fn(() => null),
    branch: vi.fn(),
    resetLeaf: vi.fn(),
    buildSessionContext: vi.fn(() => ({ messages: [] })),
    appendCustomEntry: vi.fn(),
  };
  return {
    createAgentSessionMock,
    sessionManagerOpenMock,
    resolveSandboxContextMock,
    subscribeEmbeddedPiSessionMock,
    acquireSessionWriteLockMock,
    codingTools,
    sessionManager,
    promptCalls: 0,
    lastAllowlist: [] as string[],
    lastCustomTools: [] as ToolDefinition[],
    runToolLoop: false,
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: (...args: unknown[]) => hoisted.createAgentSessionMock(...args),
    DefaultResourceLoader: class {
      async reload() {}
    },
    SessionManager: {
      open: (...args: unknown[]) =>
        hoisted.sessionManagerOpenMock(...args) ?? {
          getHeader: () => ({ type: "session", id: "shadow-session", version: 1 }),
        },
    } as unknown as typeof actual.SessionManager,
  };
});

vi.mock("../../pi-tools.js", () => ({
  createOpenClawCodingTools: () => hoisted.codingTools,
  resolveToolLoopDetectionConfig: () => ({}),
}));

vi.mock("../../pi-sdk/model-runtime.js", () => ({
  createPiModelRuntime: async () => ({ runtime: {} }),
}));

vi.mock("../../subagent-spawn.js", () => ({
  SUBAGENT_SPAWN_MODES: ["run", "session"],
  spawnSubagentDirect: vi.fn(),
}));

vi.mock("../../sandbox.js", () => ({
  resolveSandboxContext: (...args: unknown[]) => hoisted.resolveSandboxContextMock(...args),
}));

vi.mock("../../session-tool-result-guard-wrapper.js", () => ({
  guardSessionManager: () => hoisted.sessionManager,
}));

vi.mock("../../pi-embedded-subscribe.js", () => ({
  subscribeEmbeddedPiSession: (...args: unknown[]) =>
    hoisted.subscribeEmbeddedPiSessionMock(...args),
}));

vi.mock("../../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => undefined,
}));

vi.mock("../../../infra/machine-name.js", () => ({
  getMachineDisplayName: async () => "test-host",
}));

vi.mock("../../../infra/net/undici-global-dispatcher.js", () => ({
  ensureGlobalUndiciStreamTimeouts: () => {},
}));

vi.mock("../../bootstrap-files.js", () => ({
  makeBootstrapWarn: () => () => {},
  resolveBootstrapContextForRun: async () => ({ bootstrapFiles: [], contextFiles: [] }),
}));

vi.mock("../../skills.js", () => ({
  applySkillEnvOverrides: () => () => {},
  applySkillEnvOverridesFromSnapshot: () => () => {},
  filterWorkspaceSkillEntries: (entries: unknown[]) => entries,
  resolveSkillsPromptForRun: (params: { skillsSnapshot?: { prompt?: string } }) =>
    params.skillsSnapshot?.prompt ?? "",
}));

vi.mock("../skills-runtime.js", () => ({
  resolveEmbeddedRunSkillEntries: () => ({
    shouldLoadSkillEntries: false,
    skillEntries: [],
    preferLiveEntries: false,
  }),
}));

vi.mock("../../docs-path.js", () => ({
  resolveOpenClawDocsPath: async () => undefined,
}));

vi.mock("../../pi-project-settings.js", () => ({
  createPreparedEmbeddedPiSettingsManager: () => ({}),
}));

vi.mock("../../pi-settings.js", () => ({
  applyPiAutoCompactionGuard: () => {},
}));

vi.mock("../extensions.js", () => ({
  buildEmbeddedExtensionFactories: () => [],
}));

vi.mock("../google.js", () => ({
  logToolSchemasForGoogle: () => {},
  sanitizeSessionHistory: async ({ messages }: { messages: unknown[] }) => messages,
  sanitizeToolsForGoogle: ({ tools }: { tools: unknown[] }) => tools,
}));

vi.mock("../../session-file-repair.js", () => ({
  repairSessionFileIfNeeded: async () => {},
}));

vi.mock("../session-manager-cache.js", () => ({
  prewarmSessionFile: async () => {},
  trackSessionManagerAccess: () => {},
}));

vi.mock("../session-manager-init.js", () => ({
  prepareSessionManagerForRun: async () => {},
}));

vi.mock("../../session-write-lock.js", () => ({
  acquireSessionWriteLock: (...args: unknown[]) => hoisted.acquireSessionWriteLockMock(...args),
  resolveSessionLockMaxHoldFromTimeout: () => 1,
}));

vi.mock("../tool-result-context-guard.js", () => ({
  installToolResultContextGuard: () => () => {},
}));

vi.mock("../../context-compiler/flag.js", () => ({
  isContextCompilerEnabled: () => false,
}));

vi.mock("../wait-for-idle-before-flush.js", () => ({
  flushPendingToolResultsAfterIdle: async () => {},
}));

vi.mock("../runs.js", () => ({
  setActiveEmbeddedRun: () => {},
  clearActiveEmbeddedRun: () => {},
}));

vi.mock("./images.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./images.js")>();
  return {
    ...actual,
    detectAndLoadPromptImages: async () => ({ images: [] }),
  };
});

vi.mock("../../system-prompt-params.js", () => ({
  buildSystemPromptParams: () => ({
    runtimeInfo: {},
    userTimezone: "UTC",
    userTime: "00:00",
    userTimeFormat: "24h",
  }),
}));

vi.mock("../../system-prompt-report.js", () => ({
  buildSystemPromptReport: () => undefined,
}));

vi.mock("../system-prompt.js", () => ({
  applySystemPromptOverrideToSession: () => {},
  buildEmbeddedSystemPrompt: () => "system prompt",
  createSystemPromptOverride: (prompt: string) => () => prompt,
}));

vi.mock("../extra-params.js", () => ({
  applyExtraParamsToAgent: () => {},
}));

vi.mock("../../openai-ws-stream.js", () => ({
  createOpenAIWebSocketStreamFn: vi.fn(),
  releaseWsSession: () => {},
}));

vi.mock("../../anthropic-payload-log.js", () => ({
  createAnthropicPayloadLogger: () => undefined,
}));

vi.mock("../../cache-trace.js", () => ({
  createCacheTrace: () => undefined,
}));

const { runEmbeddedAttempt } =
  await import("../../../agent-runtime/execution/runner/embedded-attempt.js");

// Direct caller: explicit frozen Constitutional shadow deps (gate off, production
// no-op sink, fixed clock). No environment access and no fallback.
const constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps = Object.freeze({
  runtimeShadowEnabled: false,
  sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  now: () => 0,
});

function codingTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: { type: "object", properties: { q: { type: "string" } } },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AgentTool;
}

function skillPrompt(names: string[], note = ""): string {
  const blocks = names.map(
    (name) =>
      `<skill>\n<name>${name}</name>\n<description>Official ${name} skill.</description>\n</skill>`,
  );
  return [note, ...blocks].filter(Boolean).join("\n");
}

function createSubscriptionMock() {
  return {
    assistantTexts: [] as string[],
    toolMetas: [] as Array<{ toolName: string; meta?: string }>,
    unsubscribe: () => {},
    waitForCompactionRetry: async () => {},
    getMessagingToolSentTexts: () => [] as string[],
    getMessagingToolSentMediaUrls: () => [] as string[],
    getMessagingToolSentTargets: () => [] as unknown[],
    getSuccessfulCronAdds: () => 0,
    didSendViaMessagingTool: () => false,
    didSendReaction: () => false,
    didSendDeterministicApprovalPrompt: () => false,
    getLastToolError: () => undefined,
    getUsageTotals: () => ({ input: 12, output: 3 }),
    getCompactionCount: () => 0,
    isCompacting: () => false,
  };
}

describe("Phase 0 operational end-to-end shadow", () => {
  const tempPaths: string[] = [];
  const delivered: ChatRunObservation[] = [];
  const repoRoot = resolveRepoRoot();
  let porcelainBaseline = "";
  let nowMs = 2_000_000;

  beforeAll(() => {
    porcelainBaseline = gitPorcelain(repoRoot);
  });

  beforeEach(() => {
    hoisted.createAgentSessionMock.mockReset();
    hoisted.sessionManagerOpenMock.mockReset().mockReturnValue(hoisted.sessionManager);
    hoisted.resolveSandboxContextMock.mockReset().mockResolvedValue(undefined);
    hoisted.subscribeEmbeddedPiSessionMock.mockReset().mockImplementation(createSubscriptionMock);
    hoisted.acquireSessionWriteLockMock.mockReset().mockResolvedValue({
      release: async () => {},
    });
    hoisted.sessionManager.getLeafEntry.mockReset().mockReturnValue(null);
    hoisted.sessionManager.buildSessionContext.mockReset().mockReturnValue({ messages: [] });
    hoisted.codingTools.length = 0;
    hoisted.codingTools.push(codingTool("read"), codingTool("write"), codingTool("search"));
    hoisted.promptCalls = 0;
    hoisted.lastAllowlist = [];
    hoisted.lastCustomTools = [];
    hoisted.runToolLoop = false;
    delivered.length = 0;
    nowMs = 2_000_000;
    resetExecutionRouterObservationForTest();
    process.env.OPENBOT_EXECUTION_ROUTER_OBSERVATION = "1";
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => nowMs,
      ttlMs: 1_000,
      sink: (observation) => delivered.push(structuredClone(observation)),
    });
    hoisted.createAgentSessionMock.mockImplementation(
      async (params: { tools?: string[]; customTools?: ToolDefinition[] }) => {
        hoisted.lastAllowlist = [...(params.tools ?? [])];
        hoisted.lastCustomTools = [...(params.customTools ?? [])];
        const session = {
          sessionId: "embedded-session",
          messages: [] as unknown[],
          isCompacting: false,
          isStreaming: false,
          agent: {
            state: {
              set messages(messages: unknown[]) {
                session.messages = [...messages];
              },
            },
          },
          prompt: async () => {
            hoisted.promptCalls += 1;
            if (hoisted.runToolLoop) {
              const tool = params.customTools?.find((item) => item.name === "read");
              if (!tool) {
                throw new Error("missing read tool");
              }
              await tool.execute(
                "call-read",
                { q: "n/a" },
                undefined,
                undefined,
                {} as unknown as ExtensionContext,
              );
            }
          },
          abort: async () => {},
          dispose: () => {},
          steer: async () => {},
        };
        return { session };
      },
    );
  });

  afterEach(async () => {
    resetExecutionRouterObservationForTest();
    delete process.env.OPENBOT_EXECUTION_ROUTER_OBSERVATION;
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        await fs.rm(target, { recursive: true, force: true });
      }
    }
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });

  async function runAttempt(params: {
    runId: string;
    skills: string[];
    skillNote?: string;
    disableTools?: boolean;
    clientTools?: Array<{ name: string }>;
    skillPolicy?: { allow?: string[]; block?: string[] };
    complete?: boolean;
    toolLoop?: boolean;
  }): Promise<{ observation: ChatRunObservation | null; allowlist: string[] }> {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-ws-"));
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-agent-"));
    tempPaths.push(workspaceDir, agentDir);
    const sessionKey = `agent:test:shadow:${params.runId}`;
    hoisted.runToolLoop = Boolean(params.toolLoop);
    emitChatInboundStage({ runId: params.runId, sessionKey, stage: "user_persisted" });
    nowMs += 5;
    emitChatInboundStage({ runId: params.runId, sessionKey, stage: "dispatch_started" });
    nowMs += 5;
    emitChatInboundStage({ runId: params.runId, sessionKey, stage: "model_started" });
    nowMs += 5;
    const model = {
      api: "openai-completions",
      provider: "openai",
      compat: {},
      contextWindow: 8192,
      input: ["text"],
    } as unknown as Model<Api>;
    await runEmbeddedAttempt({
      sessionId: `session-${params.runId}`,
      sessionKey,
      sessionFile: path.join(workspaceDir, "session.jsonl"),
      workspaceDir,
      agentDir,
      config: {},
      prompt: "shadow fixture prompt",
      timeoutMs: 10_000,
      runId: params.runId,
      provider: "openai",
      modelId: "gpt-test",
      model,
      authStorage: { getApiKey: async () => undefined } as unknown as OpenBotAuthStorage,
      modelRegistry: {} as ModelRegistry,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      disableTools: params.disableTools,
      skillPolicy: params.skillPolicy
        ? { allow: params.skillPolicy.allow ?? [], block: params.skillPolicy.block ?? [] }
        : undefined,
      clientTools: params.clientTools?.map((tool) => ({
        type: "function" as const,
        function: { name: tool.name, description: `${tool.name} client`, parameters: {} },
      })),
      skillsSnapshot: {
        prompt: skillPrompt(params.skills, params.skillNote),
        skills: params.skills.map((name) => ({ name })),
      },
      constitutionalRuntimeShadowDeps,
    });
    const allowlist = [...hoisted.lastAllowlist];
    nowMs += 5;
    if (params.complete === false) {
      return {
        observation: peekExecutionRouterObservation(params.runId),
        allowlist,
      };
    }
    emitChatInboundStage({ runId: params.runId, sessionKey, stage: "first_token" });
    nowMs += 5;
    emitChatInboundStage({ runId: params.runId, sessionKey, stage: "assistant_persisted" });
    return {
      observation: delivered.find((row) => row.envelope.runId === params.runId) ?? null,
      allowlist,
    };
  }

  it("collects real runEmbeddedAttempt + prompt terminals and writes a sanitized summary", async () => {
    const samples: ShadowSample[] = [];
    const completeSpecs: Array<{
      category: ShadowCategory;
      skills: string[];
      requiredTools: string[];
      disableTools?: boolean;
      clientTools?: Array<{ name: string }>;
      skillPolicy?: { allow?: string[]; block?: string[] };
      skillNote?: string;
      toolLoop?: boolean;
    }> = [
      {
        category: "plain_text_qa",
        skills: ["weather"],
        requiredTools: [],
        disableTools: true,
      },
      {
        category: "skill_dense",
        skills: ["weather", "search", "calendar", "mail", "docs"],
        requiredTools: ["read"],
      },
      { category: "no_tools", skills: ["weather"], requiredTools: [], disableTools: true },
      { category: "single_readonly_tool", skills: ["docs"], requiredTools: ["read"] },
      {
        category: "multi_tool",
        skills: ["search", "docs"],
        requiredTools: ["read", "write", "search"],
      },
      {
        category: "client_tool",
        skills: ["browser"],
        requiredTools: ["read", "browser_open"],
        clientTools: [{ name: "browser_open" }],
      },
      {
        category: "skill_prompt_truncated",
        skills: ["only-kept"],
        requiredTools: ["read"],
        skillNote: "⚠️ Skills truncated: included 1 of 6. Run `openbot skills check` to audit.",
      },
      {
        category: "tool_policy_rejected",
        skills: ["weather"],
        requiredTools: ["read"],
        clientTools: [{ name: "browser_open" }],
        skillPolicy: { allow: ["read"], block: [] },
      },
      {
        category: "tool_call_loop",
        skills: ["docs"],
        requiredTools: ["read"],
        toolLoop: true,
      },
      {
        category: "concurrent_distinct_run_ids",
        skills: ["weather"],
        requiredTools: ["read"],
      },
    ];

    for (const spec of completeSpecs) {
      const batch = spec.category === "concurrent_distinct_run_ids" ? 5 : 5;
      const runs = Array.from({ length: batch }, (_, index) => {
        const runId = `${spec.category}-${index}`;
        const work = async () => {
          const result = await runAttempt({
            runId,
            skills: spec.skills,
            skillNote: spec.skillNote,
            disableTools: spec.disableTools,
            clientTools: spec.clientTools,
            skillPolicy: spec.skillPolicy,
            toolLoop: spec.toolLoop,
          });
          expect(result.observation).toBeTruthy();
          expect(hoisted.promptCalls).toBeGreaterThan(0);
          samples.push(
            toShadowSample({
              category: spec.category,
              terminalKind: "run_completed",
              runId,
              observation: result.observation!,
              expectedAllowlistCount: result.allowlist.length,
              requiredSkillNames: spec.skills,
              requiredToolNames: spec.requiredTools,
              injectedSkillNames: spec.skills,
              exposedToolNames: result.allowlist,
              firstToolName: spec.toolLoop ? "read" : undefined,
              firstToolSuccess: spec.toolLoop ? true : undefined,
              promptTokens: 12,
            }),
          );
        };
        return work;
      });
      if (spec.category === "concurrent_distinct_run_ids") {
        await Promise.all(runs.map((run) => run()));
      } else {
        for (const run of runs) {
          await run();
        }
      }
    }

    expect(samples.filter((sample) => sample.category === "tool_call_loop")).toHaveLength(5);
    expect(hoisted.promptCalls).toBeGreaterThanOrEqual(50);

    for (let index = 0; index < 5; index += 1) {
      const runId = `error-ttl-${index}`;
      await runAttempt({
        runId,
        skills: ["weather"],
        complete: false,
      });
    }
    nowMs += 2_000;
    emitChatInboundStage({
      runId: "ttl-trigger",
      sessionKey: "agent:test:shadow:ttl",
      stage: "user_persisted",
    });
    const ttlRows = delivered.filter((row) => row.envelope.runId.startsWith("error-ttl-"));
    expect(ttlRows.length).toBeGreaterThanOrEqual(5);
    for (const observation of ttlRows) {
      samples.push(
        toShadowSample({
          category: "plain_text_qa",
          terminalKind: "error_ttl",
          runId: observation.envelope.runId,
          observation,
          expectedAllowlistCount: observation.toolBaseline?.exposedCount ?? 0,
          requiredSkillNames: ["weather"],
          requiredToolNames: ["read"],
          injectedSkillNames: ["weather"],
          exposedToolNames: [],
        }),
      );
    }
    emitChatInboundStage({
      runId: "ttl-trigger",
      sessionKey: "agent:test:shadow:ttl",
      stage: "user_persist_error",
    });
    expect(executionRouterObservationSize()).toBe(0);

    const logical = buildLogicalArtifact(repoRoot);
    const summary = buildShadowSummary({
      sourceCommit: logical.sourceCommit,
      artifactSha256: logical.artifactSha256,
      productionBlobShas: logical.productionBlobShas,
      memoryFinalSize: executionRouterObservationSize(),
      samples,
    });
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-out-"));
    tempPaths.push(outputDir);
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    const tempSummary = path.join(outputDir, "summary.json");
    writeFileSync(tempSummary, serialized);
    execSync(`pnpm exec oxfmt --write ${JSON.stringify(tempSummary)}`, { cwd: repoRoot });
    const formatted = readFileSync(tempSummary, "utf8");
    writeFileSync(path.join(outputDir, "summary.sha256"), `${sha256Hex(formatted)}\n`);
    const validation = validateShadowSummary({
      summary,
      expectedSourceCommit: logical.sourceCommit,
      expectedArtifactSha256: logical.artifactSha256,
      collectorTexts: collectCollectorTexts(repoRoot),
    });
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(recomputeShadowMetrics(summary)).toEqual(summary.metrics);
    expect(summary.metricsKind).toBe("harness_calculation");
    expect(formatted).not.toContain("agent:main:");
    expect(formatted).not.toContain("browser_open");
    expect(formatted).not.toContain('"parameters"');
    expect(createHash("sha256").update(formatted).digest("hex")).toBe(
      readFileSync(path.join(outputDir, "summary.sha256"), "utf8").trim(),
    );
    const candidate = process.env.OPENBOT_SHADOW_CANDIDATE?.trim();
    if (candidate) {
      expect(isTrackedSummaryPath(repoRoot, candidate)).toBe(false);
      if (existsSync(candidate) && process.env.OPENBOT_SHADOW_CANDIDATE_FORCE !== "1") {
        throw new Error(`refusing to overwrite candidate ${candidate}`);
      }
      writeFileSync(candidate, formatted);
    }
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  }, 120_000);

  it("leaves the full worktree porcelain unchanged", () => {
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });
});
