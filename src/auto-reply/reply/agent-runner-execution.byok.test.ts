/**
 * Main chat turns must remap enterprise catalog ids before the embedded runner.
 * Follow-up, cron, and CLI already did. Without this, a pinned agent fails
 * before reply with `Unknown model: ent/<connection>/<upstream>`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const RUNTIME_MODEL = "cc41dd5419/mimo-v2.6-flash";
const RUNTIME_ID = `ent/${RUNTIME_MODEL}`;

const mocks = vi.hoisted(() => ({
  runEmbeddedPiAgent: vi.fn(),
  runWithModelFallback: vi.fn(),
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(),
  resolveEnterpriseRuntimeInvocation: vi.fn(),
  resolveAgentRunEntitlementScope: vi.fn(),
}));

vi.mock("../../agents/model-fallback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/model-fallback.js")>();
  return { ...actual, runWithModelFallback: mocks.runWithModelFallback };
});

vi.mock("../../agents/pi-embedded.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/pi-embedded.js")>();
  return {
    ...actual,
    queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
  };
});

vi.mock("./queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./queue.js")>();
  return { ...actual, enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() };
});

vi.mock("../../gateway/billing/agent-run-governance.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../gateway/billing/agent-run-governance.js")>();
  return {
    ...actual,
    tryAcquireEnterpriseAgentRun: mocks.tryAcquireEnterpriseAgentRun,
    releaseEnterpriseAgentRun: mocks.releaseEnterpriseAgentRun,
  };
});

vi.mock("../../gateway/enterprise-model/runtime-invocation.js", () => ({
  resolveEnterpriseRuntimeInvocation: mocks.resolveEnterpriseRuntimeInvocation,
}));

vi.mock("../../gateway/model-entitlement/resolve-agent-run-scope.js", () => ({
  resolveAgentRunEntitlementScope: mocks.resolveAgentRunEntitlementScope,
}));

import { runReplyAgent } from "./agent-runner.js";

function buildParams(opts?: {
  provider?: string;
  model?: string;
  enterpriseId?: string;
}): Parameters<typeof runReplyAgent>[0] {
  return {
    commandBody: "上午好",
    followupRun: {
      prompt: "上午好",
      enqueuedAt: Date.now(),
      run: {
        agentId: "daibai",
        agentDir: "/tmp/agent",
        sessionId: "session",
        sessionKey: "agent:daibai:main",
        messageProvider: "webchat",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        config: {
          agents: { defaults: { compaction: { memoryFlush: { enabled: false } } } },
        },
        provider: opts?.provider ?? "ent",
        model: opts?.model ?? RUNTIME_MODEL,
        ...(opts?.enterpriseId ? { executionIdentity: { enterpriseId: opts.enterpriseId } } : {}),
        thinkLevel: "low",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun,
    queueKey: "agent:daibai:main",
    resolvedQueue: { mode: "interrupt" } as QueueSettings,
    shouldSteer: false,
    shouldFollowup: false,
    isActive: false,
    isStreaming: false,
    opts: { runId: "run-byok-chat" },
    typing: createMockTypingController(),
    sessionCtx: {
      Provider: "webchat",
      Surface: "webchat",
      To: "chat-1",
      OriginatingTo: "chat-1",
      AccountId: "default",
      MessageSid: "msg-1",
    } as unknown as TemplateContext,
    defaultModel: "anthropic/claude",
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  };
}

describe("runAgentTurnWithFallback enterprise catalog models", () => {
  beforeEach(() => {
    mocks.tryAcquireEnterpriseAgentRun.mockReset();
    mocks.releaseEnterpriseAgentRun.mockReset();
    mocks.releaseEnterpriseAgentRun.mockResolvedValue(undefined);
    mocks.resolveEnterpriseRuntimeInvocation.mockReset();
    mocks.resolveAgentRunEntitlementScope.mockReset();
    mocks.resolveAgentRunEntitlementScope.mockResolvedValue(null);
    mocks.runEmbeddedPiAgent.mockReset();
    mocks.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: "上午好，需要我帮你做什么？" }],
      meta: {
        agentMeta: {
          sessionId: "session",
          provider: "openai",
          model: "mimo-v2.6-flash",
        },
      },
    });
    mocks.runWithModelFallback.mockReset();
    mocks.runWithModelFallback.mockImplementation(
      async (params: {
        provider: string;
        model: string;
        run: (provider: string, model: string) => Promise<unknown>;
      }) => ({
        result: await params.run(params.provider, params.model),
        provider: params.provider,
        model: params.model,
        attempts: [],
      }),
    );
    mocks.resolveEnterpriseRuntimeInvocation.mockResolvedValue({
      runtimeModelId: RUNTIME_ID,
      provider: "openai",
      model: "mimo-v2.6-flash",
      apiKey: "sk-tenant-mimo",
      baseUrl: "https://mimo.example/v1",
      protocol: "openai-completions",
      billingOwner: "enterprise",
      source: "enterprise",
      tenantId: "tenant-a",
    });
  });

  it("remaps ent/cc41dd5419/mimo-v2.6-flash before the embedded runner", async () => {
    mocks.tryAcquireEnterpriseAgentRun.mockResolvedValue({
      acquired: true,
      skipped: false,
      enterpriseId: "tenant-a",
      modelGate: { tenantId: "tenant-a", allowlist: [RUNTIME_ID] },
    });

    const result = await runReplyAgent(buildParams());

    expect(result).toMatchObject({ text: "上午好，需要我帮你做什么？" });
    expect(mocks.resolveEnterpriseRuntimeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        provider: "ent",
        model: RUNTIME_MODEL,
      }),
    );
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runEmbeddedPiAgent.mock.calls[0]?.[0]).toMatchObject({
      provider: "openai",
      model: "mimo-v2.6-flash",
      enterpriseRuntimeModelId: RUNTIME_ID,
      providerAuthOverride: {
        apiKey: "sk-tenant-mimo",
        source: "enterprise-byok",
        baseUrl: "https://mimo.example/v1",
        protocol: "openai-completions",
      },
    });
    expect(mocks.runEmbeddedPiAgent.mock.calls[0]?.[0]).not.toMatchObject({
      provider: "ent",
    });
  });

  it("uses the turn enterprise id when the commercial gate is skipped", async () => {
    mocks.tryAcquireEnterpriseAgentRun.mockResolvedValue({ skipped: true, acquired: false });

    const result = await runReplyAgent(buildParams({ enterpriseId: "tenant-from-session" }));

    expect(result).toMatchObject({ text: "上午好，需要我帮你做什么？" });
    expect(mocks.resolveEnterpriseRuntimeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-from-session" }),
    );
    expect(mocks.resolveAgentRunEntitlementScope).not.toHaveBeenCalled();
  });

  it("reports a missing tenant instead of Unknown model", async () => {
    mocks.tryAcquireEnterpriseAgentRun.mockResolvedValue({ skipped: true, acquired: false });

    const result = await runReplyAgent(buildParams());

    expect(mocks.runEmbeddedPiAgent).not.toHaveBeenCalled();
    const text =
      result && !Array.isArray(result) && typeof result.text === "string" ? result.text : "";
    expect(text).toContain("已配置的模型");
    expect(text).not.toContain("Unknown model");
    expect(text).not.toContain("ent/");
    expect(text).not.toContain("Logs:");
  });

  it("does not remap an ordinary catalog model", async () => {
    mocks.tryAcquireEnterpriseAgentRun.mockResolvedValue({ skipped: true, acquired: false });
    mocks.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { agentMeta: { sessionId: "session", provider: "anthropic", model: "claude" } },
    });

    const result = await runReplyAgent(buildParams({ provider: "anthropic", model: "claude" }));

    expect(result).toMatchObject({ text: "ok" });
    expect(mocks.resolveEnterpriseRuntimeInvocation).not.toHaveBeenCalled();
    expect(mocks.runEmbeddedPiAgent.mock.calls[0]?.[0]).toMatchObject({
      provider: "anthropic",
      model: "claude",
    });
  });
});
