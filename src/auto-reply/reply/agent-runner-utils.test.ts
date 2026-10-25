import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type { FollowupRun } from "./queue.js";

const hoisted = vi.hoisted(() => {
  const resolveRunModelFallbacksOverrideMock = vi.fn();
  return { resolveRunModelFallbacksOverrideMock };
});

vi.mock("../../agents/agent-scope.js", () => ({
  resolveRunModelFallbacksOverride: (...args: unknown[]) =>
    hoisted.resolveRunModelFallbacksOverrideMock(...args),
}));

const {
  buildThreadingToolContext,
  buildEmbeddedRunBaseParams,
  buildEmbeddedRunContexts,
  resolveModelFallbackOptions,
  resolveProviderScopedAuthProfile,
} = await import("./agent-runner-utils.js");

function makeRun(overrides: Partial<FollowupRun["run"]> = {}): FollowupRun["run"] {
  return {
    sessionId: "session-1",
    agentId: "agent-1",
    config: { models: { providers: {} } },
    provider: "openai",
    model: "gpt-4.1",
    agentDir: "/tmp/agent",
    sessionKey: "agent:test:session",
    sessionFile: "/tmp/session.json",
    workspaceDir: "/tmp/workspace",
    skillsSnapshot: [],
    ownerNumbers: ["+15550001"],
    enforceFinalTag: false,
    thinkLevel: "medium",
    verboseLevel: "off",
    reasoningLevel: "none",
    execOverrides: {},
    bashElevated: false,
    timeoutMs: 60_000,
    ...overrides,
  } as unknown as FollowupRun["run"];
}

describe("agent-runner-utils", () => {
  beforeEach(() => {
    hoisted.resolveRunModelFallbacksOverrideMock.mockClear();
  });

  it("resolves model fallback options from run context", () => {
    hoisted.resolveRunModelFallbacksOverrideMock.mockReturnValue(["fallback-model"]);
    const run = makeRun();

    const resolved = resolveModelFallbackOptions(run);

    expect(hoisted.resolveRunModelFallbacksOverrideMock).toHaveBeenCalledWith({
      cfg: run.config,
      agentId: run.agentId,
      sessionKey: run.sessionKey,
    });
    expect(resolved).toEqual({
      cfg: run.config,
      provider: run.provider,
      model: run.model,
      agentDir: run.agentDir,
      fallbacksOverride: ["fallback-model"],
    });
  });

  it("passes through missing agentId for helper-based fallback resolution", () => {
    hoisted.resolveRunModelFallbacksOverrideMock.mockReturnValue(["fallback-model"]);
    const run = makeRun({ agentId: undefined });

    const resolved = resolveModelFallbackOptions(run);

    expect(hoisted.resolveRunModelFallbacksOverrideMock).toHaveBeenCalledWith({
      cfg: run.config,
      agentId: undefined,
      sessionKey: run.sessionKey,
    });
    expect(resolved.fallbacksOverride).toEqual(["fallback-model"]);
  });

  it("builds embedded run base params with auth profile and run metadata", () => {
    const run = makeRun({ enforceFinalTag: true });
    const authProfile = resolveProviderScopedAuthProfile({
      provider: "openai",
      primaryProvider: "openai",
      authProfileId: "profile-openai",
      authProfileIdSource: "user",
    });

    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-1",
      authProfile,
    });

    expect(resolved).toMatchObject({
      sessionFile: run.sessionFile,
      workspaceDir: run.workspaceDir,
      agentDir: run.agentDir,
      config: run.config,
      skillsSnapshot: run.skillsSnapshot,
      ownerNumbers: run.ownerNumbers,
      enforceFinalTag: true,
      provider: "openai",
      model: "gpt-4.1-mini",
      authProfileId: "profile-openai",
      authProfileIdSource: "user",
      thinkLevel: run.thinkLevel,
      verboseLevel: run.verboseLevel,
      reasoningLevel: run.reasoningLevel,
      execOverrides: run.execOverrides,
      bashElevated: run.bashElevated,
      timeoutMs: run.timeoutMs,
      runId: "run-1",
    });
    expect(resolved).not.toHaveProperty("disableTools");
  });

  it("forwards skillPolicy so the embedded allowlist can drop blocked tools", () => {
    const run = makeRun({ skillPolicy: { block: ["exec"] } });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-skill-policy",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.skillPolicy).toEqual({ block: ["exec"] });
  });

  it("forwards skipUserTranscriptPersist and collaborationRoundInvoked for collab path", () => {
    const run = makeRun({
      skipUserTranscriptPersist: true,
      collaborationRoundInvoked: true,
    });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-collab-skip-user",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.skipUserTranscriptPersist).toBe(true);
    expect(resolved.collaborationRoundInvoked).toBe(true);
  });

  it("forwards the confirmed delivery tool fingerprint into the embedded run", () => {
    const deliveryToolSideEffect = {
      ledgerDir: "/tmp/tool-side-effects",
      taskId: "task-1",
      boardItemId: "item-1",
      stepId: "step-1",
    };
    const run = makeRun({ deliveryToolSideEffect });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-delivery-side-effect",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.deliveryToolSideEffect).toEqual(deliveryToolSideEffect);
  });

  it("forwards the private run bag into the embedded run for Residual B indexing", () => {
    const privateRunBag = {
      __privateRunBag: true as const,
      agentId: "bot-a",
      participationOverlay: null,
      capabilitySet: { personal: [], group: [], participation: [], final: [] },
      privateScratch: {},
      toolSideEffectIndex: [],
      createdAtMs: 1,
    };
    const run = makeRun({ privateRunBag });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-private-run-bag",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.privateRunBag).toBe(privateRunBag);
  });

  it("omits skipUserTranscriptPersist when not set on the queued run", () => {
    const run = makeRun();
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-no-skip-user",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved).not.toHaveProperty("skipUserTranscriptPersist");
    expect(resolved).not.toHaveProperty("collaborationRoundInvoked");
  });

  it("forwards disableTools when the queued run is chat-lane empty-tools", () => {
    const run = makeRun({ disableTools: true });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-disable-tools",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.disableTools).toBe(true);
  });

  it("forwards inboundToolCeiling when the queued run is retrieve read-only", () => {
    const ceiling = {
      depth: "retrieve" as const,
      maxToolMode: "read" as const,
      maxSideEffectLevel: "none" as const,
    };
    const run = makeRun({ inboundToolCeiling: ceiling });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-tool-ceiling",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.inboundToolCeiling).toEqual(ceiling);
  });

  it("forwards knowledgeConsumeRefs so consume tools stay on the selected file", () => {
    const knowledgeConsumeRefs = [
      { type: "knowledge-file" as const, id: "skill_c0550e28c46b", parentId: "kb_personal" },
    ];
    const run = makeRun({ knowledgeConsumeRefs });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-consume-refs",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.knowledgeConsumeRefs).toEqual(knowledgeConsumeRefs);
  });

  it("forwards mentionedPluginToolAllowlist so @plugin tools stay on the turn", () => {
    const mentionedPluginToolAllowlist = ["origin", "optional-demo"];
    const run = makeRun({ mentionedPluginToolAllowlist });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-plugin-mentions",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.mentionedPluginToolAllowlist).toEqual(mentionedPluginToolAllowlist);
  });

  it("forwards queued execution identity tenant and membership into embedded params", () => {
    const executionIdentity = createExecutionIdentityContext({
      user: "employee@acme.example",
      platformUserId: "emp-1",
      sessionDomain: "employee",
      enterpriseId: "001",
      membershipId: "mem-1",
      agentId: "ops-bot",
    });
    const run = makeRun({
      executionIdentity,
      gatewayClientUser: executionIdentity.user,
      gatewayClientSessionDomain: executionIdentity.sessionDomain,
      gatewayClientPlatformUserId: executionIdentity.platformUserId,
    });
    const resolved = buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-identity",
      authProfile: resolveProviderScopedAuthProfile({
        provider: "openai",
        primaryProvider: "openai",
      }),
    });
    expect(resolved.executionIdentity).toBe(executionIdentity);
    expect(resolved.gatewayClientSessionEnterpriseId).toBe("001");
    expect(resolved.gatewayClientSessionMembershipId).toBe("mem-1");
    expect(resolved.gatewayClientUser).toBe("employee@acme.example");
  });

  it("builds embedded contexts and scopes auth profile by provider", () => {
    const run = makeRun({
      authProfileId: "profile-openai",
      authProfileIdSource: "auto",
    });

    const resolved = buildEmbeddedRunContexts({
      run,
      sessionCtx: {
        Provider: "OpenAI",
        To: "channel-1",
        SenderId: "sender-1",
      },
      hasRepliedRef: undefined,
      provider: "anthropic",
    });

    expect(resolved.authProfile).toEqual({
      authProfileId: undefined,
      authProfileIdSource: undefined,
    });
    expect(resolved.embeddedContext).toMatchObject({
      sessionId: run.sessionId,
      sessionKey: run.sessionKey,
      agentId: run.agentId,
      messageProvider: "openai",
      messageTo: "channel-1",
    });
    expect(resolved.senderContext).toEqual({
      senderId: "sender-1",
      senderName: undefined,
      senderUsername: undefined,
      senderE164: undefined,
    });
  });

  it("prefers OriginatingChannel over Provider for messageProvider", () => {
    const run = makeRun();

    const resolved = buildEmbeddedRunContexts({
      run,
      sessionCtx: {
        Provider: "heartbeat",
        OriginatingChannel: "Telegram",
        OriginatingTo: "268300329",
      },
      hasRepliedRef: undefined,
      provider: "openai",
    });

    expect(resolved.embeddedContext.messageProvider).toBe("telegram");
    expect(resolved.embeddedContext.messageTo).toBe("268300329");
  });

  it("uses OriginatingTo for threading tool context on telegram native commands", () => {
    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "telegram",
        To: "slash:8460800771",
        OriginatingChannel: "telegram",
        OriginatingTo: "telegram:-1003841603622",
        MessageThreadId: 928,
        MessageSid: "2284",
      },
      config: { channels: { telegram: { allowFrom: ["*"] } } },
      hasRepliedRef: undefined,
    });

    expect(context).toMatchObject({
      currentChannelId: "telegram:-1003841603622",
      currentThreadTs: "928",
      currentMessageId: "2284",
    });
  });

  it("uses OriginatingTo for threading tool context on discord native commands", () => {
    const context = buildThreadingToolContext({
      sessionCtx: {
        Provider: "discord",
        To: "slash:1177378744822943744",
        OriginatingChannel: "discord",
        OriginatingTo: "channel:123456789012345678",
        MessageSid: "msg-9",
      },
      config: {},
      hasRepliedRef: undefined,
    });

    expect(context).toMatchObject({
      currentChannelId: "channel:123456789012345678",
      currentMessageId: "msg-9",
    });
  });
});
