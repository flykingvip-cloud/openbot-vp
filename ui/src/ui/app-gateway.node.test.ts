/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_EVENT_UPDATE_AVAILABLE } from "../../../src/gateway/events.js";
import { ConnectErrorDetailCodes } from "../../../src/gateway/protocol/connect-error-details.js";
import {
  applySnapshot,
  connectGateway,
  resolveControlUiClientVersion,
  setAppGatewayPageUrlForTests,
  setAppGatewayTestHooks,
} from "./app-gateway.ts";
import { clearSessionIncubationEventsForTests } from "./controllers/asset-incubation/session-event-store.ts";
import {
  clearAssetSuggestionDismissalsForTests,
  dismissAssetSuggestion,
} from "./controllers/asset-incubation/suggestion-dismiss.ts";
import {
  GATEWAY_RECONNECTING_CLOSE_BUDGET,
  resolveGatewayChatBanner,
  type GatewayConnectionPhase,
} from "./gateway-connection-phase.ts";

type GatewayClientMock = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  options: {
    url?: string;
    clientVersion?: string;
    authMode?: string | null;
    trustedProxySession?: {
      provider: "trusted-proxy";
      user: string;
      role?: string;
      scopes?: string[];
    } | null;
    onReconnectUrl?: (currentUrl: string) => string | null;
  };
  emitClose: (info: {
    code: number;
    reason?: string;
    error?: { code: string; message: string; details?: unknown };
  }) => void;
  emitGap: (expected: number, received: number) => void;
  emitEvent: (evt: { type?: "event"; event: string; payload?: unknown; seq?: number }) => void;
  emitHello: (hello?: Record<string, unknown>) => void;
};

const gatewayClientInstances: GatewayClientMock[] = [];

function resolveGatewayErrorDetailCode(
  error: { details?: unknown } | null | undefined,
): string | null {
  const details = error?.details;
  if (!details || typeof details !== "object") {
    return null;
  }
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function createHost() {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    password: "",
    clientInstanceId: "instance-test",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "OpenBot",
    assistantAvatar: null,
    assistantAgentId: null,
    serverVersion: null,
    bootstrapAuthMode: null,
    bootstrapAuthSession: null,
    platformAuthState: null,
    sessionKey: "main",
    workbenchAssetSuggestionVisible: false,
    workbenchAssetSuggestionSource: null,
    workbenchAssetSuggestionLabel: null,
    workbenchAssetIncubationLevel: null,
    workbenchAssetIncubationDecision: null,
    workbenchAssetWeakHintVisible: false,
    workbenchPatternDetectionSubscribedScopes: [],
    workbenchSkillSourceContextId: null,
    chatRunId: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    updateAvailable: null,
  } as unknown as Parameters<typeof connectGateway>[0];
}

describe("connectGateway", () => {
  beforeEach(() => {
    clearSessionIncubationEventsForTests();
    clearAssetSuggestionDismissalsForTests();
    gatewayClientInstances.length = 0;
    setAppGatewayTestHooks({
      createClient: (opts) => {
        const start = vi.fn();
        const stop = vi.fn();
        const client = {
          start,
          stop,
          options: {
            url: opts.url,
            clientVersion: opts.clientVersion,
            authMode: opts.authMode ?? null,
            trustedProxySession: opts.trustedProxySession ?? null,
            onReconnectUrl: opts.onReconnectUrl,
          },
          emitClose: (info: {
            code: number;
            reason?: string;
            error?: { code: string; message: string; details?: unknown };
          }) => {
            opts.onClose?.({
              code: info.code,
              reason: info.reason ?? "",
              error: info.error,
            });
          },
          emitGap: (expected: number, received: number) => {
            opts.onGap?.({ expected, received });
          },
          emitEvent: (evt: { type?: "event"; event: string; payload?: unknown; seq?: number }) => {
            opts.onEvent?.({
              type: "event",
              ...evt,
            });
          },
          emitHello: (hello?: Record<string, unknown>) => {
            opts.onHello?.(hello as never);
          },
        };
        gatewayClientInstances.push(client);
        return {
          start,
          stop,
          request: vi.fn(async () => {
            throw new Error("gateway offline");
          }),
        } as never;
      },
      resolveErrorDetailCode: resolveGatewayErrorDetailCode,
    });
  });

  afterEach(() => {
    clearAssetSuggestionDismissalsForTests();
    setAppGatewayPageUrlForTests(null);
    setAppGatewayTestHooks(null);
  });

  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitGap(10, 13);
    expect(host.lastError).toBeNull();

    secondClient.emitGap(20, 24);
    expect(host.lastError).toBe(
      "event gap detected (expected seq 20, got 24); refresh recommended",
    );
  });

  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({ event: "presence", payload: { presence: [{ host: "stale" }] } });
    expect(host.eventLogBuffer).toHaveLength(0);

    secondClient.emitEvent({ event: "presence", payload: { presence: [{ host: "active" }] } });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");
  });

  it("applies update.available only from active client", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "9.9.9", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toBeNull();

    secondClient.emitEvent({
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "2.0.0", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toEqual({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      channel: "latest",
    });
  });

  it("records L2 incubation but does not open system suggestion for a single artifact session", () => {
    const host = createHost();
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "agent:main:main",
        state: "final",
        message: {
          role: "assistant",
          text: "✅ 任务完成总结\n\nreport.md\n\n# 销售周报\n本周进展如下……",
          artifactId: "artifact-1",
        },
      },
    });

    expect(host.workbenchAssetSuggestionVisible).toBe(false);
    expect(host.workbenchAssetIncubationLevel).toBe("L2");
    expect(host.workbenchAssetWeakHintVisible).toBe(true);
    expect(host.workbenchSkillSourceContextId).toBeNull();
  });

  it("opens system asset suggestion after repeated stable completions reach L3", () => {
    const host = createHost();
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    const payload = {
      runId: "run-1",
      sessionKey: "agent:main:main",
      state: "final" as const,
      message: {
        role: "assistant" as const,
        text: "✅ 任务完成总结\n\nreport.md\n\n# 销售周报\n本周进展如下……",
        artifactId: "artifact-1",
      },
    };

    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-1" } });
    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-2" } });
    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-3" } });

    expect(host.workbenchAssetSuggestionVisible).toBe(true);
    expect(host.workbenchAssetIncubationLevel).toBe("L3");
    expect(host.workbenchAssetIncubationDecision?.level).toBe("L3");
    expect(host.workbenchAssetIncubationDecision?.evidence.recurrenceCount).toBe(3);
    expect(host.workbenchAssetWeakHintVisible).toBe(false);
    expect(host.workbenchAssetSuggestionSource).toBe("assistant-task-complete");
    expect(host.workbenchSkillSourceContextId).toBe("artifact-1");
  });

  it("does not resurface system asset suggestion after user dismisses 暂不处理", () => {
    const host = createHost();
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    const payload = {
      runId: "run-1",
      sessionKey: "agent:main:main",
      state: "final" as const,
      message: {
        role: "assistant" as const,
        text: "✅ 任务完成总结\n\nreport.md\n\n# 销售周报\n本周进展如下……",
        artifactId: "artifact-1",
      },
    };

    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-1" } });
    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-2" } });
    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-3" } });
    expect(host.workbenchAssetSuggestionVisible).toBe(true);

    dismissAssetSuggestion({
      contextId: "artifact-1",
      sessionKey: "agent:main:main",
    });
    host.workbenchAssetSuggestionVisible = false;

    client.emitEvent({ event: "chat", payload: { ...payload, runId: "run-4" } });
    expect(host.workbenchAssetSuggestionVisible).toBe(false);
    expect(host.workbenchAssetWeakHintVisible).toBe(false);
  });

  it("opens system asset suggestion after three cross-session completions with the same pattern", () => {
    const host = createHost();
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    const message = {
      role: "assistant" as const,
      text: "✅ 任务完成总结\n\nreport.md\n\n# 销售周报\n本周进展如下……",
      artifactId: "artifact-1",
    };

    client.emitEvent({
      event: "chat",
      payload: { runId: "run-a", sessionKey: "agent:a:main", state: "final", message },
    });
    client.emitEvent({
      event: "chat",
      payload: { runId: "run-b", sessionKey: "agent:b:main", state: "final", message },
    });
    expect(host.workbenchAssetSuggestionVisible).toBe(false);
    expect(host.workbenchAssetIncubationLevel).toBe("L2");

    client.emitEvent({
      event: "chat",
      payload: { runId: "run-c", sessionKey: "agent:c:main", state: "final", message },
    });

    expect(host.workbenchAssetSuggestionVisible).toBe(true);
    expect(host.workbenchAssetIncubationLevel).toBe("L3");
    expect(host.workbenchAssetIncubationDecision?.evidence.recurrenceCount).toBe(3);
  });

  it("does not open system suggestion for a single collaboration completion", () => {
    const host = createHost();
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitEvent({
      event: "chat",
      payload: {
        runId: "run-2",
        sessionKey: "space:product",
        state: "final",
        message: {
          role: "assistant",
          text: "✅ 任务完成总结\n\n本次复盘结论已整理完成。",
        },
      },
    });

    expect(host.workbenchAssetSuggestionVisible).toBe(false);
    expect(host.workbenchAssetIncubationLevel).toBe("L1");
    expect(host.workbenchSkillSourceContextId).toBeNull();
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitClose({ code: 1005 });
    expect(host.lastError).toBeNull();
    expect(host.lastErrorCode).toBeNull();

    // Transient codes (1005/1006/1001/1012) stay silent — use a non-transient close
    // to assert the *active* client still surfaces actionable disconnects.
    secondClient.emitClose({ code: 4000, reason: "policy" });
    expect(host.lastError).toBe("disconnected (4000): policy");
    expect(host.lastErrorCode).toBeNull();
  });

  it("maps generic fetch-failed auth errors to actionable token mismatch message", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH);
    expect(host.lastError).toContain("gateway token mismatch");
  });

  it("maps TypeError fetch failures to actionable auth rate-limit guidance", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "TypeError: Failed to fetch",
        details: { code: ConnectErrorDetailCodes.AUTH_RATE_LIMITED },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_RATE_LIMITED);
    expect(host.lastError).toContain("too many failed authentication attempts");
  });

  it("preserves specific close errors even when auth detail codes are present", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "Failed to fetch gateway metadata from ws://127.0.0.1:18789",
        details: { code: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH },
      },
    });

    expect(host.lastErrorCode).toBe(ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH);
    expect(host.lastError).toBe("Failed to fetch gateway metadata from ws://127.0.0.1:18789");
  });

  it("auto-recovers to the current loopback Control UI target on origin errors", () => {
    const host = createHost();
    host.settings.gatewayUrl = `ws://0.0.0.0${window.location.port ? `:${window.location.port}` : ""}`;

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message:
          "origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)",
      },
    });

    expect(host.settings.gatewayUrl).toBe(`ws://${window.location.host}`);
    expect(gatewayClientInstances).toHaveLength(2);
    expect(host.lastError).toBeNull();
  });

  it("reuses bootstrap trusted-proxy session only for the current gateway target", () => {
    const host = createHost();
    host.settings.gatewayUrl = `ws://${window.location.host}/openclaw/`;
    host.serverVersion = "2026.3.7";
    host.bootstrapAuthMode = "trusted-proxy";
    host.bootstrapAuthSession = {
      provider: "trusted-proxy",
      user: "alice@example.com",
      role: "operator",
      scopes: ["operator.read"],
    };

    connectGateway(host);
    expect(gatewayClientInstances[0]?.options).toMatchObject({
      clientVersion: "2026.3.7",
      authMode: "trusted-proxy",
      trustedProxySession: {
        provider: "trusted-proxy",
        user: "alice@example.com",
        role: "operator",
        scopes: ["operator.read"],
      },
    });
  });

  it("pins trusted-proxy sessions to the Control UI page origin instead of a foreign gateway", () => {
    const host = createHost();
    host.settings.gatewayUrl = "wss://gateway.example.com";
    host.serverVersion = "2026.3.7";
    host.bootstrapAuthMode = "trusted-proxy";
    host.bootstrapAuthSession = {
      provider: "trusted-proxy",
      user: "alice@example.com",
      role: "operator",
      scopes: ["operator.read"],
    };

    connectGateway(host);
    const options = gatewayClientInstances[0]?.options;
    // Cookie-backed sessions must not ride a foreign host; rewrite to page origin.
    expect(options?.url).not.toBe("wss://gateway.example.com");
    expect(options).toMatchObject({
      authMode: "trusted-proxy",
      trustedProxySession: {
        provider: "trusted-proxy",
        user: "alice@example.com",
      },
    });
  });

  it("auto-recovers stale public-home gateway URL on biz host before connect", () => {
    setAppGatewayPageUrlForTests("https://biz.openbot.love/enterprise/organization");
    const host = createHost();
    host.settings.gatewayUrl = "wss://www.openbot.love";

    connectGateway(host);

    expect(host.settings.gatewayUrl).toBe("wss://biz.openbot.love");
    expect(gatewayClientInstances).toHaveLength(1);
    expect(gatewayClientInstances[0]?.options.url).toBe("wss://biz.openbot.love");
  });

  it("auto-recovers stale public-home gateway URL after transport disconnect on biz", () => {
    setAppGatewayPageUrlForTests("https://biz.openbot.love/enterprise/organization");
    const host = createHost();
    host.settings.gatewayUrl = "wss://www.openbot.love";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();
    expect(host.settings.gatewayUrl).toBe("wss://biz.openbot.love");

    client.emitClose({ code: 1006, reason: "" });

    expect(client.options.onReconnectUrl?.("wss://www.openbot.love")).toBe(
      "wss://biz.openbot.love",
    );
    expect(host.settings.gatewayUrl).toBe("wss://biz.openbot.love");
    expect(host.lastError).toBeNull();
  });

  it("prefers structured connect errors over close reason", () => {
    const host = createHost();

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message:
          "unauthorized: gateway token mismatch (open the dashboard URL and paste the token in Control UI settings)",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });

    expect(host.lastError).toContain("gateway token mismatch");
    expect(host.lastErrorCode).toBe("AUTH_TOKEN_MISMATCH");
  });

  function phaseOf(host: ReturnType<typeof createHost>) {
    return host as ReturnType<typeof createHost> & {
      gatewayConnectionPhase: GatewayConnectionPhase;
      gatewayReconnectAttempt: number;
      chatLoading?: boolean;
    };
  }

  it("shows reconnecting after 1006 and before hello, not chat.disconnected", () => {
    const host = phaseOf(createHost());
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({ code: 1006, reason: "" });

    expect(host.connected).toBe(false);
    expect(host.lastError).toBeNull();
    expect(host.gatewayConnectionPhase).toBe("reconnecting");
    const banner = resolveGatewayChatBanner({
      connected: host.connected,
      phase: host.gatewayConnectionPhase,
    });
    expect(banner.kind).toBe("status");
    if (banner.kind === "status") {
      expect(banner.messageKey).toBe("chat.reconnecting");
      expect(banner.messageKey).not.toBe("chat.disconnected");
    }
  });

  it("latches gateway unreachable after the close budget and clears chat loading", () => {
    const host = phaseOf(createHost());
    host.chatLoading = true;
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    for (let i = 0; i < GATEWAY_RECONNECTING_CLOSE_BUDGET + 1; i++) {
      client.emitClose({ code: 1006, reason: "" });
    }

    expect(host.gatewayConnectionPhase).toBe("unreachable");
    expect(host.chatLoading).toBe(false);
    expect(host.connected).toBe(false);
    const banner = resolveGatewayChatBanner({
      connected: host.connected,
      phase: host.gatewayConnectionPhase,
    });
    expect(banner).toEqual({ kind: "status", messageKey: "chat.gatewayUnreachable" });
    expect(banner).not.toEqual({ kind: "status", messageKey: "chat.disconnected" });
  });

  it("clears the reconnecting banner when hello succeeds", () => {
    const host = phaseOf(createHost());
    Object.assign(host, {
      toolStreamById: new Map(),
      toolStreamOrder: [],
      chatToolMessages: [],
      chatStreamSegments: [],
    });
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();
    client.emitClose({ code: 1006, reason: "" });
    expect(host.gatewayConnectionPhase).toBe("reconnecting");

    client.emitHello({ type: "hello-ok", protocol: 3 });

    expect(host.connected).toBe(true);
    expect(host.lastError).toBeNull();
    expect(host.gatewayConnectionPhase).toBe("connected");
    expect(host.gatewayReconnectAttempt).toBe(0);
    expect(
      resolveGatewayChatBanner({
        connected: host.connected,
        phase: host.gatewayConnectionPhase,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("keeps the in-flight chat run when hello arrives after a transport drop", () => {
    const host = phaseOf(createHost());
    const live = Object.assign(host, {
      chatRunId: "run-live",
      chatStream: "周报草稿",
      chatStreamStartedAt: 50,
      workProgressPhase: "drafting" as const,
      workProgressToolsInFlight: 1,
      toolStreamById: new Map([["call-1", { toolCallId: "call-1" }]]),
      toolStreamOrder: ["call-1"],
      chatToolMessages: [{ role: "toolResult" }],
      chatStreamSegments: [{ text: "周报草稿", ts: 50 }],
    });
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();
    client.emitClose({ code: 1006, reason: "" });

    client.emitHello({ type: "hello-ok", protocol: 3 });

    expect(live.chatRunId).toBe("run-live");
    expect(live.chatStream).toBe("周报草稿");
    expect(live.chatStreamStartedAt).toBe(50);
    expect(live.workProgressPhase).toBe("drafting");
    expect(live.workProgressToolsInFlight).toBe(1);
    expect(live.toolStreamOrder).toEqual(["call-1"]);
  });

  it("keeps AUTH_TOKEN_MISSING as a sticky disconnect instead of reconnecting", () => {
    const host = phaseOf(createHost());
    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitClose({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized: gateway token missing",
        details: { code: "AUTH_TOKEN_MISSING" },
      },
    });

    expect(host.gatewayConnectionPhase).toBe("blocked");
    expect(host.gatewayReconnectAttempt).toBe(0);
    expect(host.lastError).toContain("gateway token missing");
    expect(host.lastErrorCode).toBe("AUTH_TOKEN_MISSING");
    const banner = resolveGatewayChatBanner({
      connected: host.connected,
      phase: host.gatewayConnectionPhase,
    });
    expect(banner).toEqual({ kind: "status", messageKey: "chat.disconnected" });
    expect(banner).not.toEqual({ kind: "status", messageKey: "chat.reconnecting" });
  });

  it("does not let a stale client onClose overwrite the new connection phase", () => {
    const host = phaseOf(createHost());
    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();
    firstClient.emitClose({ code: 1006, reason: "" });
    expect(host.gatewayConnectionPhase).toBe("reconnecting");
    expect(host.gatewayReconnectAttempt).toBe(1);

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();
    expect(host.gatewayConnectionPhase).toBe("connecting");
    expect(host.gatewayReconnectAttempt).toBe(0);

    firstClient.emitClose({ code: 1006, reason: "" });
    expect(host.gatewayConnectionPhase).toBe("connecting");
    expect(host.gatewayReconnectAttempt).toBe(0);
    expect(host.lastError).toBeNull();

    secondClient.emitClose({ code: 1006, reason: "" });
    expect(host.gatewayConnectionPhase).toBe("reconnecting");
    expect(host.gatewayReconnectAttempt).toBe(1);
  });
});

describe("applySnapshot", () => {
  it("initializes workbenchTeamSelectedKey from session defaults when nav is unset", () => {
    const host = createHost() as Parameters<typeof applySnapshot>[0] & {
      workbenchTeamSelectedKey?: string;
    };
    host.sessionKey = "main";
    host.settings.sessionKey = "main";
    host.settings.lastActiveSessionKey = "main";
    host.workbenchTeamSelectedKey = "";

    applySnapshot(host, {
      snapshot: {
        sessionDefaults: {
          mainSessionKey: "agent:main:employee:alice",
          mainKey: "main",
        },
      },
    } as never);

    expect(host.workbenchTeamSelectedKey).toBe("agent:main:employee:alice");
    expect(host.sessionKey).toBe("agent:main:employee:alice");
  });

  it("resets sticky foreign employee steward keys from a prior user to hello mainSessionKey", () => {
    const host = createHost() as Parameters<typeof applySnapshot>[0] & {
      workbenchTeamSelectedKey?: string;
    };
    const elle = "agent:main:employee:475156c1-03e7-44ad-9fb2-fcc880374b82";
    const daniel = "agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    host.sessionKey = daniel;
    host.settings.sessionKey = daniel;
    host.settings.lastActiveSessionKey = daniel;
    host.workbenchTeamSelectedKey = daniel;

    applySnapshot(host, {
      snapshot: {
        sessionDefaults: {
          mainSessionKey: elle,
          mainKey: "main",
          defaultAgentId: "main",
        },
      },
    } as never);

    expect(host.workbenchTeamSelectedKey).toBe(elle);
    expect(host.sessionKey).toBe(elle);
    expect(host.settings.sessionKey).toBe(elle);
    expect(host.settings.lastActiveSessionKey).toBe(elle);
  });

  it("leaves collaboration space selection alone when hello brings employee mainSessionKey", () => {
    const host = createHost() as Parameters<typeof applySnapshot>[0] & {
      workbenchTeamSelectedKey?: string;
    };
    const elle = "agent:main:employee:475156c1-03e7-44ad-9fb2-fcc880374b82";
    const space = "space:grp-demo";
    host.sessionKey = space;
    host.settings.sessionKey = space;
    host.settings.lastActiveSessionKey = space;
    host.workbenchTeamSelectedKey = space;

    applySnapshot(host, {
      snapshot: {
        sessionDefaults: {
          mainSessionKey: elle,
          mainKey: "main",
        },
      },
    } as never);

    expect(host.workbenchTeamSelectedKey).toBe(space);
    expect(host.sessionKey).toBe(space);
    expect(host.settings.sessionKey).toBe(space);
  });

  it("rewrites the two-part agent:main nav key to the employee steward session", () => {
    const host = createHost() as Parameters<typeof applySnapshot>[0] & {
      workbenchTeamSelectedKey?: string;
    };
    host.sessionKey = "agent:main";
    host.settings.sessionKey = "agent:main";
    host.settings.lastActiveSessionKey = "agent:main";
    host.workbenchTeamSelectedKey = "agent:main";

    applySnapshot(host, {
      snapshot: {
        sessionDefaults: {
          mainSessionKey: "agent:main:employee:alice",
          mainKey: "main",
          defaultAgentId: "main",
        },
      },
    } as never);

    expect(host.workbenchTeamSelectedKey).toBe("agent:main:employee:alice");
    expect(host.sessionKey).toBe("agent:main:employee:alice");
  });
});

describe("resolveControlUiClientVersion", () => {
  it("returns serverVersion for same-origin websocket targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "ws://localhost:8787",
        serverVersion: "2026.3.7",
        pageUrl: "http://localhost:8787/openclaw/",
      }),
    ).toBe("2026.3.7");
  });

  it("returns serverVersion for same-origin relative targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "/ws",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/openclaw/",
      }),
    ).toBe("2026.3.7");
  });

  it("returns serverVersion for same-origin http targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "https://control.example.com/ws",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/openclaw/",
      }),
    ).toBe("2026.3.7");
  });

  it("omits serverVersion for cross-origin targets", () => {
    expect(
      resolveControlUiClientVersion({
        gatewayUrl: "wss://gateway.example.com",
        serverVersion: "2026.3.7",
        pageUrl: "https://control.example.com/openclaw/",
      }),
    ).toBeUndefined();
  });
});
