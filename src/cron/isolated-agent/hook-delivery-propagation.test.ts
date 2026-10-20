import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookDeliveryResult } from "../../agents/execution-preflight/hook-delivery.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  hasDeliveryContext,
  readExecutionTraces,
  resetCompletionHoldsForTest,
  resetExecutionTraceForTest,
} from "../../agents/execution-preflight/index.js";
import { callGateway } from "../../gateway/call.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  loadRunCronIsolatedAgentTurn,
  pickLastNonEmptyTextFromPayloadsMock,
  resolveAgentMainSessionKeyMock,
  updateSessionStoreMock,
  runEmbeddedPiAgentMock,
  runWithModelFallbackMock,
  surfaceCronJobResultMock,
} from "./run.test-harness.js";

const configHolder: { current: Record<string, unknown> | undefined } = { current: undefined };

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configHolder.current ?? actual.loadConfig(),
  };
});

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(async () => ({ ok: true })),
}));

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();
const realSurface =
  await vi.importActual<typeof import("./result-surfacing.js")>("./result-surfacing.js");
const actualSessions = await vi.importActual<typeof import("../../config/sessions.js")>(
  "../../config/sessions.js",
);

const AGENT = "default";
const roots: string[] = [];

function delivery(
  overrides: Partial<HookDeliveryResult> &
    Pick<HookDeliveryResult, "taskId" | "decisionCode" | "allowedToDeliver">,
): HookDeliveryResult {
  return {
    attemptNumber: 1,
    validatorsRequired: true,
    ...overrides,
  };
}

function preflight(taskId: string) {
  return buildExecutionPreflight({
    taskId,
    sessionId: `agent:${AGENT}:main`,
    message: "请做一个 canvas",
    skills: [],
    policyToolNames: ["read", "write"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

function layout() {
  const root = mkdtempSync(path.join(tmpdir(), "openbot-hook-prop-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const store = path.join(root, "sessions", "sessions.json");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.dirname(store), { recursive: true });
  return {
    root,
    workspace,
    cfg: {
      session: { store, mainKey: "main" },
      agents: { defaults: { workspace }, list: [{ id: AGENT, default: true, workspace }] },
    },
  };
}

function embeddedResult(params: {
  delivery?: HookDeliveryResult;
  taskId?: string;
  text?: string;
  hookValidatorsRequired?: boolean;
}) {
  return {
    payloads: [{ text: params.text ?? "任务已完成" }],
    meta: {
      taskId: params.taskId ?? params.delivery?.taskId,
      ...(params.delivery ? { hookDelivery: params.delivery } : {}),
      hookValidatorsRequired:
        params.hookValidatorsRequired ?? params.delivery?.validatorsRequired === true,
      agentMeta: { usage: { input: 1, output: 1 } },
    },
  };
}

function useRealHookSession() {
  resolveAgentMainSessionKeyMock.mockImplementation((params) => {
    const agentId = params?.agentId?.trim() || AGENT;
    const mainKey = params?.cfg?.session?.mainKey?.trim() || "main";
    return `agent:${agentId}:${mainKey}`;
  });
  updateSessionStoreMock.mockImplementation(async (storePath, updater) => {
    if (typeof storePath === "string" && storePath.includes("openbot-hook-prop-")) {
      return actualSessions.updateSessionStore(storePath, updater);
    }
    return undefined;
  });
}

async function runHook(params: {
  env: ReturnType<typeof layout>;
  embedded: ReturnType<typeof embeddedResult> | Array<ReturnType<typeof embeddedResult>>;
  jobId?: string;
  summaryText?: string;
}) {
  const results = Array.isArray(params.embedded) ? params.embedded : [params.embedded];
  for (const result of results) {
    runEmbeddedPiAgentMock.mockResolvedValueOnce(result);
  }
  pickLastNonEmptyTextFromPayloadsMock.mockImplementation((payloads?: Array<{ text?: string }>) => {
    for (let index = (payloads?.length ?? 0) - 1; index >= 0; index -= 1) {
      const text = payloads?.[index]?.text;
      if (text?.trim()) {
        return text;
      }
    }
    return "";
  });
  useRealHookSession();
  runWithModelFallbackMock.mockImplementation(
    async (input: {
      provider: string;
      model: string;
      run: (provider: string, model: string) => Promise<unknown>;
    }) => {
      const result = await input.run(input.provider, input.model);
      return { result, provider: input.provider, model: input.model, attempts: [] };
    },
  );
  surfaceCronJobResultMock.mockImplementation((input: unknown) =>
    realSurface.surfaceCronJobResult(input as never),
  );
  const jobId = params.jobId ?? "job-prop";
  return runCronIsolatedAgentTurn(
    makeIsolatedAgentTurnParams({
      cfg: params.env.cfg,
      message: "请做一个 canvas",
      sessionKey: `hook:${jobId}`,
      job: {
        id: jobId,
        name: "canary",
        delivery: { mode: "none" },
        payload: { kind: "agentTurn", message: "请做一个 canvas" },
      },
    }) as never,
  );
}

describe("hook delivery evidence propagation", () => {
  setupRunCronIsolatedAgentTurnSuite();

  beforeEach(() => {
    vi.mocked(callGateway).mockReset();
    vi.mocked(callGateway).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    resetCompletionHoldsForTest();
    resetExecutionTraceForTest();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries a verified receipt from the embedded result to one inject", async () => {
    const env = layout();
    const task = preflight("task-prop-ok");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: task, ttlMs: 60_000 });
    const evidence = delivery({
      taskId: task.taskId,
      decisionCode: "delivery_receipt_verified",
      allowedToDeliver: true,
    });
    let seenBeforeInject = false;
    vi.mocked(callGateway).mockImplementation(async () => {
      const trace = readExecutionTraces(task.taskId).find(
        (row) => row.decisionCode === "delivery_receipt_verified",
      );
      seenBeforeInject =
        trace?.transportOutcome === "not_called" && trace.cleanupReason === "retained";
      return { ok: true };
    });
    await runHook({ env, embedded: embeddedResult({ delivery: evidence, taskId: task.taskId }) });
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(seenBeforeInject).toBe(true);
    expect(hasDeliveryContext(task.taskId)).toBe(false);
    const trace = readExecutionTraces(task.taskId).find((row) => row.transportOutcome === "ok");
    expect(trace?.decisionCode).toBe("delivery_receipt_verified");
    expect(trace?.cleanupReason).toBe("delivered");
    expect(trace?.hookDeliveryPresent).toBe(true);
    expect(trace?.hookDeliveryTaskMatch).toBe(true);
    expect(trace?.attemptTaskIdHash).toEqual(expect.any(String));
    expect(trace?.hookJobIdHash).toEqual(expect.any(String));
  });

  it.each([
    ["delivery_blocked", "missing"],
    ["validation_failed", "bad-json"],
    ["validation_failed", "bad-edge"],
    ["validation_failed", "too-large"],
    ["artifact_changed", "changed"],
    ["validator_unavailable", "unregistered"],
  ] as const)("does not transport %s (%s)", async (decisionCode, name) => {
    const env = layout();
    const task = preflight(`task-prop-${name}`);
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: task, ttlMs: 60_000 });
    await runHook({
      env,
      embedded: embeddedResult({
        taskId: task.taskId,
        delivery: delivery({ taskId: task.taskId, decisionCode, allowedToDeliver: false }),
      }),
    });
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(task.taskId)).toBe(true);
    const trace = readExecutionTraces(task.taskId).find(
      (row) => row.decisionStage === "hook_surface",
    );
    expect(trace?.decisionCode).toBe(decisionCode);
    expect(trace?.transportOutcome).toBe("blocked");
  });

  it("fail-closes when a required validator result is missing", async () => {
    const env = layout();
    await runHook({
      env,
      embedded: embeddedResult({
        taskId: "task-prop-missing-result",
        hookValidatorsRequired: true,
      }),
    });
    expect(callGateway).not.toHaveBeenCalled();
    const traces = readExecutionTraces("task-prop-missing-result");
    expect(traces.some((row) => row.decisionCode === "hook_delivery_result_missing")).toBe(true);
    expect(traces.some((row) => row.transportOutcome === "blocked")).toBe(true);
  });

  it("does not clean either task when the delivery task id mismatches", async () => {
    const env = layout();
    const attempt = preflight("task-prop-attempt");
    const other = preflight("task-prop-other");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: attempt, ttlMs: 60_000 });
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: other, ttlMs: 60_000 });
    await runHook({
      env,
      embedded: embeddedResult({
        taskId: attempt.taskId,
        delivery: delivery({
          taskId: other.taskId,
          decisionCode: "delivery_receipt_verified",
          allowedToDeliver: true,
        }),
      }),
    });
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(attempt.taskId)).toBe(true);
    expect(hasDeliveryContext(other.taskId)).toBe(true);
    expect(
      readExecutionTraces(other.taskId).some(
        (row) => row.decisionCode === "hook_delivery_task_mismatch",
      ),
    ).toBe(true);
  });

  it("keeps the winning fallback attempt", async () => {
    const env = layout();
    useRealHookSession();
    const second = preflight("task-prop-fallback-2");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: second, ttlMs: 60_000 });
    runEmbeddedPiAgentMock
      .mockRejectedValueOnce(Object.assign(new Error("rate limit"), { status: 429 }))
      .mockResolvedValueOnce(
        embeddedResult({
          taskId: second.taskId,
          delivery: delivery({
            taskId: second.taskId,
            decisionCode: "delivery_receipt_verified",
            allowedToDeliver: true,
          }),
        }),
      );
    pickLastNonEmptyTextFromPayloadsMock.mockReturnValue("任务已完成");
    runWithModelFallbackMock.mockImplementation(
      async (input: {
        provider: string;
        model: string;
        run: (provider: string, model: string) => Promise<unknown>;
      }) => {
        try {
          await input.run("lost", "lost");
        } catch {
          // The losing provider must not become the frozen receipt.
        }
        const result = await input.run(input.provider, input.model);
        return { result, provider: input.provider, model: input.model, attempts: [] };
      },
    );
    surfaceCronJobResultMock.mockImplementation((input: unknown) =>
      realSurface.surfaceCronJobResult(input as never),
    );
    await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        cfg: env.cfg,
        sessionKey: "hook:job-fallback",
        job: {
          id: "job-fallback",
          name: "canary",
          delivery: { mode: "none" },
          payload: { kind: "agentTurn", message: "请做一个 canvas" },
        },
      }) as never,
    );
    expect(hasDeliveryContext(second.taskId)).toBe(false);
    expect(callGateway).toHaveBeenCalledTimes(1);
  });

  it("uses the second interim attempt instead of the acknowledgement receipt", async () => {
    const env = layout();
    const first = preflight("task-prop-interim-1");
    const second = preflight("task-prop-interim-2");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: first, ttlMs: 60_000 });
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: second, ttlMs: 60_000 });
    await runHook({
      env,
      embedded: [
        embeddedResult({
          text: "On it, grabbing current SF and SD weather now and I will summarize right after both come back.",
          taskId: first.taskId,
          delivery: delivery({
            taskId: first.taskId,
            decisionCode: "delivery_receipt_verified",
            allowedToDeliver: true,
          }),
        }),
        embeddedResult({
          text: "SF is 62F and SD is 67F.",
          taskId: second.taskId,
          delivery: delivery({
            taskId: second.taskId,
            decisionCode: "delivery_blocked",
            allowedToDeliver: false,
          }),
        }),
      ],
    });
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(first.taskId)).toBe(true);
    expect(hasDeliveryContext(second.taskId)).toBe(true);
    expect(
      readExecutionTraces(second.taskId).some((row) => row.decisionCode === "delivery_blocked"),
    ).toBe(true);
  });

  it("keeps an ordinary hook inject when no validator is required", async () => {
    const env = layout();
    await runHook({
      env,
      embedded: embeddedResult({
        text: "进度更新",
        delivery: delivery({
          taskId: "task-prop-ordinary",
          decisionCode: "not_required",
          allowedToDeliver: true,
          validatorsRequired: false,
        }),
      }),
    });
    expect(callGateway).toHaveBeenCalledTimes(1);
  });

  it("does not send or clean the same job twice", async () => {
    const env = layout();
    const task = preflight("task-prop-retry");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: task, ttlMs: 60_000 });
    const evidence = delivery({
      taskId: task.taskId,
      decisionCode: "delivery_receipt_verified",
      allowedToDeliver: true,
    });
    vi.mocked(callGateway).mockImplementation(async (request) => {
      const params = request.params as {
        sessionKey?: string;
        cronJobId?: string;
        cronRunId?: string;
      };
      const { readFileSync, writeFileSync } = await import("node:fs");
      const store = JSON.parse(readFileSync(env.cfg.session.store, "utf8")) as Record<
        string,
        { sessionFile?: string }
      >;
      const file = store[params.sessionKey ?? ""]?.sessionFile;
      if (file) {
        writeFileSync(
          file,
          `${readFileSync(file, "utf8")}${JSON.stringify({ message: { openclawCronResult: { jobId: params.cronJobId, runId: params.cronRunId } } })}\n`,
        );
      }
      return { ok: true };
    });
    await runHook({
      env,
      jobId: "job-retry",
      embedded: embeddedResult({ delivery: evidence, taskId: task.taskId }),
    });
    await runHook({
      env,
      jobId: "job-retry",
      embedded: embeddedResult({ delivery: evidence, taskId: task.taskId }),
    });
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(
      readExecutionTraces(task.taskId).filter((row) => row.cleanupReason === "delivered"),
    ).toHaveLength(1);
  });

  it("retains the task when transport throws", async () => {
    const env = layout();
    const task = preflight("task-prop-throw");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: task, ttlMs: 60_000 });
    vi.mocked(callGateway).mockRejectedValueOnce(new Error("inject down"));
    await runHook({
      env,
      embedded: embeddedResult({
        taskId: task.taskId,
        delivery: delivery({
          taskId: task.taskId,
          decisionCode: "delivery_receipt_verified",
          allowedToDeliver: true,
        }),
      }),
    });
    expect(hasDeliveryContext(task.taskId)).toBe(true);
    const trace = readExecutionTraces(task.taskId).find((row) => row.transportOutcome === "failed");
    expect(trace?.transportOutcome).toBe("failed");
    expect(trace?.cleanupReason).toBe("retained");
  });

  it("starts at the hook HTTP entry and still reaches transport once", async () => {
    const env = layout();
    const task = preflight("task-prop-http");
    armCompletionHold({ keys: [`agent:${AGENT}:main`], preflight: task, ttlMs: 60_000 });
    const evidence = delivery({
      taskId: task.taskId,
      decisionCode: "delivery_receipt_verified",
      allowedToDeliver: true,
    });
    configHolder.current = env.cfg;
    useRealHookSession();
    runEmbeddedPiAgentMock.mockResolvedValue(
      embeddedResult({ delivery: evidence, taskId: task.taskId }),
    );
    pickLastNonEmptyTextFromPayloadsMock.mockReturnValue("任务已完成");
    runWithModelFallbackMock.mockImplementation(
      async (input: {
        provider: string;
        model: string;
        run: (provider: string, model: string) => Promise<unknown>;
      }) => {
        const result = await input.run(input.provider, input.model);
        return { result, provider: input.provider, model: input.model, attempts: [] };
      },
    );
    surfaceCronJobResultMock.mockImplementation((input: unknown) =>
      realSurface.surfaceCronJobResult(input as never),
    );
    const { createGatewayHooksRequestHandler } = await import("../../gateway/server/hooks.js");
    const handler = createGatewayHooksRequestHandler({
      deps: {} as never,
      bindHost: "127.0.0.1",
      port: 0,
      logHooks: createSubsystemLogger("hook-prop"),
      getHooksConfig: () => ({
        basePath: "/hooks",
        token: "hook-test-token",
        maxBodyBytes: 64 * 1024,
        mappings: [],
        agentPolicy: {
          defaultAgentId: "default",
          knownAgentIds: new Set(["default"]),
          allowedAgentIds: undefined,
        },
        sessionPolicy: { allowRequestSessionKey: false },
      }),
    });
    const server = http.createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/hooks/agent`, {
        method: "POST",
        headers: { Authorization: "Bearer hook-test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ message: "请做一个 canvas", name: "canary" }),
      });
      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(callGateway).toHaveBeenCalledTimes(1);
        expect(hasDeliveryContext(task.taskId)).toBe(false);
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
