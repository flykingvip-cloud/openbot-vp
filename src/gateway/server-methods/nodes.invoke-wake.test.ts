import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as preflightResolve from "../../agents/execution-preflight/resolve.js";
import {
  readExecutionTraces,
  resetExecutionTraceForTest,
} from "../../agents/execution-preflight/trace.js";
import { ErrorCodes } from "../protocol/index.js";
import {
  NODE_INVOKE_PREFLIGHT_OBSERVE_ENV,
  isNodeInvokePreflightObserveEnabled,
  nodeHandlers,
  nodeInvokeObserveTaskId,
} from "./nodes.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  resolveNodeCommandAllowlist: vi.fn<(...args: unknown[]) => unknown>(() => []),
  isNodeCommandAllowed: vi.fn<(...args: unknown[]) => unknown>(() => ({ ok: true })),
  sanitizeNodeInvokeParamsForForwarding: vi.fn<(...args: unknown[]) => unknown>((opts) => ({
    ok: true,
    params: (opts as { rawParams: unknown }).rawParams,
  })),
  loadApnsRegistration: vi.fn(),
  resolveApnsAuthConfigFromEnv: vi.fn(),
  sendApnsBackgroundWake: vi.fn(),
  sendApnsAlert: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../node-command-policy.js", () => ({
  resolveNodeCommandAllowlist: mocks.resolveNodeCommandAllowlist,
  isNodeCommandAllowed: mocks.isNodeCommandAllowed,
}));

vi.mock("../node-invoke-sanitize.js", () => ({
  sanitizeNodeInvokeParamsForForwarding: mocks.sanitizeNodeInvokeParamsForForwarding,
}));

vi.mock("../../infra/push-apns.js", () => ({
  loadApnsRegistration: mocks.loadApnsRegistration,
  resolveApnsAuthConfigFromEnv: mocks.resolveApnsAuthConfigFromEnv,
  sendApnsBackgroundWake: mocks.sendApnsBackgroundWake,
  sendApnsAlert: mocks.sendApnsAlert,
}));

type RespondCall = [
  boolean,
  unknown?,
  {
    code?: number;
    message?: string;
    details?: unknown;
  }?,
  Record<string, unknown>?,
];

type TestNodeSession = {
  nodeId: string;
  commands: string[];
  platform?: string;
};

function iosSession(commands: string[] = ["camera.list"]): TestNodeSession {
  return { nodeId: "ios-node-1", commands, platform: "ios" };
}

function connectedRegistry(
  session: TestNodeSession,
  invokeResult?: {
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  },
) {
  return {
    get: vi.fn((nodeId: string) => (nodeId === session.nodeId ? session : undefined)),
    invoke: vi.fn().mockResolvedValue(
      invokeResult ?? {
        ok: true,
        payload: { devices: ["back"] },
        payloadJSON: '{"devices":["back"]}',
      },
    ),
  };
}

const WAKE_WAIT_TIMEOUT_MS = 3_001;

function makeNodeInvokeParams(overrides?: Partial<Record<string, unknown>>) {
  return {
    nodeId: "ios-node-1",
    command: "camera.capture",
    params: { quality: "high" },
    timeoutMs: 5000,
    idempotencyKey: "idem-node-invoke",
    ...overrides,
  };
}

async function invokeNode(params: {
  nodeRegistry: {
    get: (nodeId: string) => TestNodeSession | undefined;
    invoke: (payload: {
      nodeId: string;
      command: string;
      params?: unknown;
      timeoutMs?: number;
      idempotencyKey?: string;
    }) => Promise<{
      ok: boolean;
      payload?: unknown;
      payloadJSON?: string | null;
      error?: { code?: string; message?: string } | null;
    }>;
  };
  requestParams?: Partial<Record<string, unknown>>;
  dedupe?: Map<string, unknown>;
  /** Same object required for in-flight join (WeakMap-keyed). */
  sharedContext?: Record<string, unknown>;
}) {
  const respond = vi.fn();
  const logGateway = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  const context = (params.sharedContext ?? {
    nodeRegistry: params.nodeRegistry,
    execApprovalManager: undefined,
    logGateway,
    ...(params.dedupe ? { dedupe: params.dedupe } : {}),
  }) as never;
  if (params.sharedContext) {
    params.sharedContext.nodeRegistry = params.nodeRegistry;
    if (params.dedupe) {
      params.sharedContext.dedupe = params.dedupe;
    }
    if (!params.sharedContext.logGateway) {
      params.sharedContext.logGateway = logGateway;
    }
  }
  await nodeHandlers["node.invoke"]({
    params: makeNodeInvokeParams(params.requestParams),
    respond: respond as never,
    context,
    client: null,
    req: { type: "req", id: "req-node-invoke", method: "node.invoke" },
    isWebchatConnect: () => false,
  });
  return respond;
}

async function pullPending(nodeId: string) {
  const respond = vi.fn();
  await nodeHandlers["node.pending.pull"]({
    params: {},
    respond: respond as never,
    context: {} as never,
    client: {
      connect: {
        role: "node",
        client: {
          id: nodeId,
          mode: "node",
          name: "ios-test",
          platform: "iOS 26.4.0",
          version: "test",
        },
      },
    } as never,
    req: { type: "req", id: "req-node-pending", method: "node.pending.pull" },
    isWebchatConnect: () => false,
  });
  return respond;
}

async function ackPending(nodeId: string, ids: string[]) {
  const respond = vi.fn();
  await nodeHandlers["node.pending.ack"]({
    params: { ids },
    respond: respond as never,
    context: {} as never,
    client: {
      connect: {
        role: "node",
        client: {
          id: nodeId,
          mode: "node",
          name: "ios-test",
          platform: "iOS 26.4.0",
          version: "test",
        },
      },
    } as never,
    req: { type: "req", id: "req-node-pending-ack", method: "node.pending.ack" },
    isWebchatConnect: () => false,
  });
  return respond;
}

function mockSuccessfulWakeConfig(nodeId: string) {
  mocks.loadApnsRegistration.mockResolvedValue({
    nodeId,
    token: "abcd1234abcd1234abcd1234abcd1234",
    topic: "ai.openbot.ios",
    environment: "sandbox",
    updatedAtMs: 1,
  });
  mocks.resolveApnsAuthConfigFromEnv.mockResolvedValue({
    ok: true,
    value: {
      teamId: "TEAM123",
      keyId: "KEY123",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", // pragma: allowlist secret
    },
  });
  mocks.sendApnsBackgroundWake.mockResolvedValue({
    ok: true,
    status: 200,
    tokenSuffix: "1234abcd",
    topic: "ai.openbot.ios",
    environment: "sandbox",
  });
}

describe("node.invoke APNs wake path", () => {
  beforeEach(() => {
    mocks.loadConfig.mockClear();
    mocks.loadConfig.mockReturnValue({});
    mocks.resolveNodeCommandAllowlist.mockClear();
    mocks.resolveNodeCommandAllowlist.mockReturnValue([]);
    mocks.isNodeCommandAllowed.mockClear();
    mocks.isNodeCommandAllowed.mockReturnValue({ ok: true });
    mocks.sanitizeNodeInvokeParamsForForwarding.mockClear();
    mocks.sanitizeNodeInvokeParamsForForwarding.mockImplementation((opts: unknown) => ({
      ok: true,
      params: (opts as { rawParams: unknown }).rawParams,
    }));
    mocks.loadApnsRegistration.mockClear();
    mocks.resolveApnsAuthConfigFromEnv.mockClear();
    mocks.sendApnsBackgroundWake.mockClear();
    mocks.sendApnsAlert.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the existing not-connected response when wake path is unavailable", async () => {
    mocks.loadApnsRegistration.mockResolvedValue(null);

    const nodeRegistry = {
      get: vi.fn(() => undefined),
      invoke: vi.fn().mockResolvedValue({ ok: true }),
    };

    const respond = await invokeNode({ nodeRegistry });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.UNAVAILABLE);
    expect(call?.[2]?.message).toBe("node not connected");
    expect(mocks.sendApnsBackgroundWake).not.toHaveBeenCalled();
    expect(nodeRegistry.invoke).not.toHaveBeenCalled();
  });

  it("wakes and retries invoke after the node reconnects", async () => {
    vi.useFakeTimers();
    mockSuccessfulWakeConfig("ios-node-reconnect");

    let connected = false;
    const session: TestNodeSession = { nodeId: "ios-node-reconnect", commands: ["camera.capture"] };
    const nodeRegistry = {
      get: vi.fn((nodeId: string) => {
        if (nodeId !== "ios-node-reconnect") {
          return undefined;
        }
        return connected ? session : undefined;
      }),
      invoke: vi.fn().mockResolvedValue({
        ok: true,
        payload: { ok: true },
        payloadJSON: '{"ok":true}',
      }),
    };

    const invokePromise = invokeNode({
      nodeRegistry,
      requestParams: { nodeId: "ios-node-reconnect", idempotencyKey: "idem-reconnect" },
    });
    setTimeout(() => {
      connected = true;
    }, 300);

    await vi.advanceTimersByTimeAsync(WAKE_WAIT_TIMEOUT_MS);
    const respond = await invokePromise;

    expect(mocks.sendApnsBackgroundWake).toHaveBeenCalledTimes(1);
    expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
    expect(nodeRegistry.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "ios-node-reconnect",
        command: "camera.capture",
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({ ok: true, nodeId: "ios-node-reconnect" });
  });

  it("forces one retry wake when the first wake still fails to reconnect", async () => {
    vi.useFakeTimers();
    mockSuccessfulWakeConfig("ios-node-throttle");

    const nodeRegistry = {
      get: vi.fn(() => undefined),
      invoke: vi.fn().mockResolvedValue({ ok: true }),
    };

    const invokePromise = invokeNode({
      nodeRegistry,
      requestParams: { nodeId: "ios-node-throttle", idempotencyKey: "idem-throttle-1" },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await invokePromise;

    expect(mocks.sendApnsBackgroundWake).toHaveBeenCalledTimes(2);
    expect(nodeRegistry.invoke).not.toHaveBeenCalled();
  });

  it("queues iOS foreground-only command failures and keeps them until acked", async () => {
    mocks.loadApnsRegistration.mockResolvedValue(null);

    const nodeRegistry = {
      get: vi.fn(() => ({
        nodeId: "ios-node-queued",
        commands: ["canvas.navigate"],
        platform: "iOS 26.4.0",
      })),
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "NODE_BACKGROUND_UNAVAILABLE",
          message: "NODE_BACKGROUND_UNAVAILABLE: canvas/camera/screen commands require foreground",
        },
      }),
    };

    const respond = await invokeNode({
      nodeRegistry,
      requestParams: {
        nodeId: "ios-node-queued",
        command: "canvas.navigate",
        params: { url: "http://example.com/" },
        idempotencyKey: "idem-queued",
      },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.UNAVAILABLE);
    expect(call?.[2]?.message).toBe("node command queued until iOS returns to foreground");
    expect(mocks.sendApnsBackgroundWake).not.toHaveBeenCalled();

    const pullRespond = await pullPending("ios-node-queued");
    const pullCall = pullRespond.mock.calls[0] as RespondCall | undefined;
    expect(pullCall?.[0]).toBe(true);
    expect(pullCall?.[1]).toMatchObject({
      nodeId: "ios-node-queued",
      actions: [
        expect.objectContaining({
          command: "canvas.navigate",
          paramsJSON: JSON.stringify({ url: "http://example.com/" }),
        }),
      ],
    });

    const repeatedPullRespond = await pullPending("ios-node-queued");
    const repeatedPullCall = repeatedPullRespond.mock.calls[0] as RespondCall | undefined;
    expect(repeatedPullCall?.[0]).toBe(true);
    expect(repeatedPullCall?.[1]).toMatchObject({
      nodeId: "ios-node-queued",
      actions: [
        expect.objectContaining({
          command: "canvas.navigate",
          paramsJSON: JSON.stringify({ url: "http://example.com/" }),
        }),
      ],
    });

    const queuedActionId = (pullCall?.[1] as { actions?: Array<{ id?: string }> } | undefined)
      ?.actions?.[0]?.id;
    expect(queuedActionId).toBeTruthy();

    const ackRespond = await ackPending("ios-node-queued", [queuedActionId!]);
    const ackCall = ackRespond.mock.calls[0] as RespondCall | undefined;
    expect(ackCall?.[0]).toBe(true);
    expect(ackCall?.[1]).toMatchObject({
      nodeId: "ios-node-queued",
      ackedIds: [queuedActionId],
      remainingCount: 0,
    });

    const emptyPullRespond = await pullPending("ios-node-queued");
    const emptyPullCall = emptyPullRespond.mock.calls[0] as RespondCall | undefined;
    expect(emptyPullCall?.[0]).toBe(true);
    expect(emptyPullCall?.[1]).toMatchObject({
      nodeId: "ios-node-queued",
      actions: [],
    });
  });

  it("dedupes queued foreground actions by idempotency key", async () => {
    mocks.loadApnsRegistration.mockResolvedValue(null);

    const nodeRegistry = {
      get: vi.fn(() => ({
        nodeId: "ios-node-dedupe",
        commands: ["canvas.navigate"],
        platform: "iPadOS 26.4.0",
      })),
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "NODE_BACKGROUND_UNAVAILABLE",
          message: "NODE_BACKGROUND_UNAVAILABLE: canvas/camera/screen commands require foreground",
        },
      }),
    };

    await invokeNode({
      nodeRegistry,
      requestParams: {
        nodeId: "ios-node-dedupe",
        command: "canvas.navigate",
        params: { url: "http://example.com/first" },
        idempotencyKey: "idem-dedupe",
      },
    });
    await invokeNode({
      nodeRegistry,
      requestParams: {
        nodeId: "ios-node-dedupe",
        command: "canvas.navigate",
        params: { url: "http://example.com/first" },
        idempotencyKey: "idem-dedupe",
      },
    });

    const pullRespond = await pullPending("ios-node-dedupe");
    const pullCall = pullRespond.mock.calls[0] as RespondCall | undefined;
    expect(pullCall?.[0]).toBe(true);
    expect(pullCall?.[1]).toMatchObject({
      nodeId: "ios-node-dedupe",
      actions: [
        expect.objectContaining({
          command: "canvas.navigate",
          paramsJSON: JSON.stringify({ url: "http://example.com/first" }),
        }),
      ],
    });
    const actions = (pullCall?.[1] as { actions?: unknown[] } | undefined)?.actions ?? [];
    expect(actions).toHaveLength(1);
  });

  it("joins an in-flight node.invoke when the same key carries the same payload (timeout retry)", async () => {
    mocks.loadApnsRegistration.mockResolvedValue(null);
    const dedupe = new Map<string, unknown>();
    const sharedContext: Record<string, unknown> = {};
    let release: (value: {
      ok: true;
      payload: { presented: boolean };
      payloadJSON: null;
    }) => void = () => {};
    const nodeRegistry = connectedRegistry(iosSession(["canvas.present"]), {
      ok: true,
      payload: { presented: true },
      payloadJSON: null,
    });
    nodeRegistry.invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = invokeNode({
      nodeRegistry,
      dedupe,
      sharedContext,
      requestParams: {
        command: "canvas.present",
        params: { url: "http://example.com/same" },
        idempotencyKey: "idem-node-timeout-retry",
      },
    });
    await vi.waitFor(() => {
      expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
    });
    const second = invokeNode({
      nodeRegistry,
      dedupe,
      sharedContext,
      requestParams: {
        command: "canvas.present",
        params: { url: "http://example.com/same" },
        idempotencyKey: "idem-node-timeout-retry",
      },
    });
    release({ ok: true, payload: { presented: true }, payloadJSON: null });
    const [firstRespond, secondRespond] = await Promise.all([first, second]);

    expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
    expect((firstRespond.mock.calls[0] as RespondCall | undefined)?.[0]).toBe(true);
    expect((secondRespond.mock.calls[0] as RespondCall | undefined)?.[0]).toBe(true);
    expect((secondRespond.mock.calls[0] as RespondCall | undefined)?.[3]).toMatchObject({
      cached: true,
    });
  });

  it("rejects a reused node.invoke idempotency key when the payload differs", async () => {
    mocks.loadApnsRegistration.mockResolvedValue(null);
    const dedupe = new Map<string, unknown>();
    const nodeRegistry = connectedRegistry(iosSession(["canvas.present"]), {
      ok: true,
      payload: { presented: true },
      payloadJSON: null,
    });

    const first = await invokeNode({
      nodeRegistry,
      dedupe,
      requestParams: {
        command: "canvas.present",
        params: { url: "http://example.com/first" },
        idempotencyKey: "idem-payload-conflict",
      },
    });
    const second = await invokeNode({
      nodeRegistry,
      dedupe,
      requestParams: {
        command: "canvas.present",
        params: { url: "http://example.com/second" },
        idempotencyKey: "idem-payload-conflict",
      },
    });

    expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
    expect((first.mock.calls[0] as RespondCall | undefined)?.[0]).toBe(true);
    const conflict = second.mock.calls[0] as RespondCall | undefined;
    expect(conflict?.[0]).toBe(false);
    expect(conflict?.[2]).toMatchObject({
      code: "INVALID_REQUEST",
      message: "idempotency key reused with a different payload",
      details: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT", status: 409 },
    });
  });

  it("rejects a queued node.invoke when the same key is reused with a different command", async () => {
    mocks.loadApnsRegistration.mockResolvedValue(null);
    const nodeId = "ios-node-queue-conflict";
    const dedupe = new Map<string, unknown>();
    const nodeRegistry = {
      get: vi.fn((requestedId: string) =>
        requestedId === nodeId
          ? {
              nodeId,
              commands: ["canvas.navigate", "canvas.present"],
              platform: "ios",
            }
          : undefined,
      ),
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "NODE_BACKGROUND_UNAVAILABLE",
          message: "NODE_BACKGROUND_UNAVAILABLE: canvas/camera/screen commands require foreground",
        },
      }),
    };

    await invokeNode({
      nodeRegistry,
      dedupe,
      requestParams: {
        nodeId,
        command: "canvas.navigate",
        params: { url: "http://example.com/first" },
        idempotencyKey: "idem-queue-conflict",
      },
    });
    const conflictRespond = await invokeNode({
      nodeRegistry,
      dedupe,
      requestParams: {
        nodeId,
        command: "canvas.present",
        params: { url: "http://example.com/first" },
        idempotencyKey: "idem-queue-conflict",
      },
    });

    expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
    expect((conflictRespond.mock.calls[0] as RespondCall | undefined)?.[2]).toMatchObject({
      details: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT", status: 409 },
    });
    const pullRespond = await pullPending(nodeId);
    const actions =
      ((pullRespond.mock.calls[0] as RespondCall | undefined)?.[1] as { actions?: unknown[] })
        ?.actions ?? [];
    expect(actions).toHaveLength(1);
  });
});

describe("node.invoke preflight observe", () => {
  let realPolicy!: typeof import("../node-command-policy.js");

  beforeEach(async () => {
    delete process.env[NODE_INVOKE_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
    realPolicy = await vi.importActual<typeof import("../node-command-policy.js")>(
      "../node-command-policy.js",
    );
    const realSanitize = await vi.importActual<typeof import("../node-invoke-sanitize.js")>(
      "../node-invoke-sanitize.js",
    );
    mocks.loadConfig.mockReset();
    mocks.loadConfig.mockReturnValue({});
    mocks.resolveNodeCommandAllowlist.mockReset();
    mocks.resolveNodeCommandAllowlist.mockImplementation((cfg, node) =>
      realPolicy.resolveNodeCommandAllowlist(
        cfg as Parameters<typeof realPolicy.resolveNodeCommandAllowlist>[0],
        node as Parameters<typeof realPolicy.resolveNodeCommandAllowlist>[1],
      ),
    );
    mocks.isNodeCommandAllowed.mockReset();
    mocks.isNodeCommandAllowed.mockImplementation((params) =>
      realPolicy.isNodeCommandAllowed(
        params as Parameters<typeof realPolicy.isNodeCommandAllowed>[0],
      ),
    );
    mocks.sanitizeNodeInvokeParamsForForwarding.mockReset();
    mocks.sanitizeNodeInvokeParamsForForwarding.mockImplementation((opts) =>
      realSanitize.sanitizeNodeInvokeParamsForForwarding(
        opts as Parameters<typeof realSanitize.sanitizeNodeInvokeParamsForForwarding>[0],
      ),
    );
    mocks.loadApnsRegistration.mockReset();
    mocks.loadApnsRegistration.mockResolvedValue(null);
    mocks.resolveApnsAuthConfigFromEnv.mockReset();
    mocks.sendApnsBackgroundWake.mockReset();
    mocks.sendApnsAlert.mockReset();
  });

  afterEach(() => {
    delete process.env[NODE_INVOKE_PREFLIGHT_OBSERVE_ENV];
    resetExecutionTraceForTest();
  });

  it("keeps the invoke outcome unchanged when preflight observe is off", async () => {
    expect(isNodeInvokePreflightObserveEnabled({})).toBe(false);
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(
        isNodeInvokePreflightObserveEnabled({
          [NODE_INVOKE_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(false);
    }
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const nodeRegistry = connectedRegistry(iosSession());
      const respond = await invokeNode({
        nodeRegistry,
        requestParams: { command: "camera.list" },
      });
      const call = respond.mock.calls[0] as RespondCall | undefined;
      expect(call).toEqual([
        true,
        {
          ok: true,
          nodeId: "ios-node-1",
          command: "camera.list",
          payload: { devices: ["back"] },
          payloadJSON: '{"devices":["back"]}',
        },
        undefined,
        undefined,
      ]);
      expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
      expect(nodeRegistry.invoke).toHaveBeenCalledWith({
        nodeId: "ios-node-1",
        command: "camera.list",
        params: { quality: "high" },
        timeoutMs: 5000,
        idempotencyKey: "idem-node-invoke",
      });
      expect(spy).not.toHaveBeenCalled();
      expect(readExecutionTraces(nodeInvokeObserveTaskId("ios-node-1", "camera.list"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("records a preflight trace when observe is on without changing the invoke outcome", async () => {
    for (const value of ["1", "true", "yes", "on"]) {
      expect(
        isNodeInvokePreflightObserveEnabled({
          [NODE_INVOKE_PREFLIGHT_OBSERVE_ENV]: value,
        }),
      ).toBe(true);
    }
    process.env[NODE_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const session = iosSession();
      const nodeRegistry = connectedRegistry(session);
      const taskId = nodeInvokeObserveTaskId(session.nodeId, "camera.list");
      const respond = await invokeNode({
        nodeRegistry,
        requestParams: { command: "camera.list" },
      });
      const call = respond.mock.calls[0] as RespondCall | undefined;
      expect(call).toEqual([
        true,
        {
          ok: true,
          nodeId: "ios-node-1",
          command: "camera.list",
          payload: { devices: ["back"] },
          payloadJSON: '{"devices":["back"]}',
        },
        undefined,
        undefined,
      ]);
      expect(nodeRegistry.invoke).toHaveBeenCalledWith({
        nodeId: "ios-node-1",
        command: "camera.list",
        params: { quality: "high" },
        timeoutMs: 5000,
        idempotencyKey: "idem-node-invoke",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        taskId,
        sessionId: "node:ios-node-1",
        message: "camera.list",
        skills: [],
        policyToolNames: [...realPolicy.resolveNodeCommandAllowlist({}, session)],
        catalogToolNames: ["camera.list"],
      });
      const traces = readExecutionTraces(taskId);
      expect(traces.some((row) => row.decisionStage === "preflight")).toBe(true);
      expect(traces.every((row) => row.decisionStage === "preflight")).toBe(true);
      expect(traces[0]?.decisionCode).toBe("no_skill_contract");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not record a preflight trace when pairing, allowlist, or sanitize already denies", async () => {
    process.env[NODE_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const disconnected = {
        get: vi.fn(() => undefined),
        invoke: vi.fn().mockResolvedValue({ ok: true }),
      };
      const missing = await invokeNode({ nodeRegistry: disconnected });
      const missingCall = missing.mock.calls[0] as RespondCall | undefined;
      expect(missingCall?.[0]).toBe(false);
      expect(missingCall?.[2]?.code).toBe(ErrorCodes.UNAVAILABLE);
      expect(missingCall?.[2]?.message).toBe("node not connected");
      expect(missingCall?.[2]?.details).toEqual({ code: "NOT_CONNECTED" });
      expect(disconnected.invoke).not.toHaveBeenCalled();

      const deniedRegistry = connectedRegistry(iosSession(["camera.snap"]));
      const denied = await invokeNode({
        nodeRegistry: deniedRegistry,
        requestParams: { command: "camera.snap", idempotencyKey: "idem-deny-allow" },
      });
      const deniedCall = denied.mock.calls[0] as RespondCall | undefined;
      expect(deniedCall?.[0]).toBe(false);
      expect(deniedCall?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
      expect(deniedCall?.[2]?.details).toEqual({
        reason: "command not allowlisted",
        command: "camera.snap",
      });
      expect(deniedRegistry.invoke).not.toHaveBeenCalled();

      const undeclaredRegistry = connectedRegistry(iosSession(["location.get"]));
      const undeclared = await invokeNode({
        nodeRegistry: undeclaredRegistry,
        requestParams: { command: "camera.list", idempotencyKey: "idem-deny-declared" },
      });
      const undeclaredCall = undeclared.mock.calls[0] as RespondCall | undefined;
      expect(undeclaredCall?.[0]).toBe(false);
      expect(undeclaredCall?.[2]?.details).toEqual({
        reason: "command not declared by node",
        command: "camera.list",
      });
      expect(undeclaredRegistry.invoke).not.toHaveBeenCalled();

      const approvals = await invokeNode({
        nodeRegistry: connectedRegistry({
          nodeId: "ios-node-1",
          commands: ["system.execApprovals.get"],
          platform: "ios",
        }),
        requestParams: {
          command: "system.execApprovals.get",
          idempotencyKey: "idem-exec-approvals",
        },
      });
      const approvalsCall = approvals.mock.calls[0] as RespondCall | undefined;
      expect(approvalsCall?.[0]).toBe(false);
      expect(approvalsCall?.[2]?.message).toBe(
        "node.invoke does not allow system.execApprovals.*; use exec.approvals.node.*",
      );

      const runRegistry = connectedRegistry({
        nodeId: "mac-node-1",
        commands: ["system.run"],
        platform: "macos",
      });
      const sanitized = await invokeNode({
        nodeRegistry: runRegistry,
        requestParams: {
          nodeId: "mac-node-1",
          command: "system.run",
          params: { approved: true },
          idempotencyKey: "idem-sanitize",
        },
      });
      const sanitizedCall = sanitized.mock.calls[0] as RespondCall | undefined;
      expect(sanitizedCall?.[0]).toBe(false);
      expect(sanitizedCall?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
      expect(sanitizedCall?.[2]?.message).toBe("approval override requires params.runId");
      expect(sanitizedCall?.[2]?.details).toMatchObject({ code: "MISSING_RUN_ID" });
      expect(runRegistry.invoke).not.toHaveBeenCalled();

      expect(spy).not.toHaveBeenCalled();
      expect(readExecutionTraces(nodeInvokeObserveTaskId("ios-node-1", "camera.capture"))).toEqual(
        [],
      );
      expect(readExecutionTraces(nodeInvokeObserveTaskId("ios-node-1", "camera.snap"))).toEqual([]);
      expect(readExecutionTraces(nodeInvokeObserveTaskId("mac-node-1", "system.run"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps a node error when observe is on", async () => {
    process.env[NODE_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight");
    try {
      const nodeRegistry = connectedRegistry(iosSession(), {
        ok: false,
        error: { code: "NODE_COMMAND_FAILED", message: "boom" },
      });
      const respond = await invokeNode({
        nodeRegistry,
        requestParams: { command: "camera.list" },
      });
      const call = respond.mock.calls[0] as RespondCall | undefined;
      expect(call?.[0]).toBe(false);
      expect(call?.[2]?.code).toBe(ErrorCodes.UNAVAILABLE);
      expect(call?.[2]?.message).toBe("NODE_COMMAND_FAILED: boom");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("swallows observe failures without flipping a successful invoke", async () => {
    process.env[NODE_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    const spy = vi.spyOn(preflightResolve, "buildExecutionPreflight").mockImplementation(() => {
      throw new Error("observe boom");
    });
    try {
      const nodeRegistry = connectedRegistry(iosSession());
      const respond = await invokeNode({
        nodeRegistry,
        requestParams: { command: "camera.list" },
      });
      const call = respond.mock.calls[0] as RespondCall | undefined;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(nodeRegistry.invoke).toHaveBeenCalledTimes(1);
      expect(call).toEqual([
        true,
        {
          ok: true,
          nodeId: "ios-node-1",
          command: "camera.list",
          payload: { devices: ["back"] },
          payloadJSON: '{"devices":["back"]}',
        },
        undefined,
        undefined,
      ]);
      expect(readExecutionTraces(nodeInvokeObserveTaskId("ios-node-1", "camera.list"))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not enforce preflight on the node invoke path", () => {
    const source = fs.readFileSync(new URL("./nodes.ts", import.meta.url), "utf8");
    expect(source).toContain("buildExecutionPreflight");
    expect(source).toContain("OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
  });
});
