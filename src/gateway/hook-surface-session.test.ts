import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookDeliveryResult } from "../agents/execution-preflight/hook-delivery.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  hasDeliveryContext,
  JSON_CANVAS_MAX_BYTES,
  JSON_CANVAS_VALIDATOR_ID,
  noteDeliveryArtifactPath,
  readExecutionTraces,
  resolveAttemptDelivery,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  resetValidationStateForTest,
  runProductionValidatorsForAttempt,
  setProductionValidatorRegistrationForTest,
  toHookDeliveryResult,
} from "../agents/execution-preflight/index.js";
import { clearSessionStoreCaches } from "../config/sessions/store-cache.js";
import { surfaceCronJobResult } from "../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../cron/types.js";
import { onAgentEvent } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { callGateway } from "./call.js";
import { ensureHookSurfaceTranscript } from "./hook-surface-session.js";
import { createGatewayHooksRequestHandler } from "./server/hooks.js";

const hookBridge = vi.hoisted(() => ({
  run: null as
    | ((params: { job: { id: string; agentId?: string }; sessionKey?: string }) => Promise<{
        status: "ok";
        delivered: boolean;
        summary: string;
      }>)
    | null,
}));

vi.mock("./call.js", () => ({
  callGateway: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../cron/isolated-agent.js", () => ({
  runCronIsolatedAgentTurn: (params: {
    job: { id: string; agentId?: string };
    sessionKey?: string;
  }) =>
    hookBridge.run?.(params) ??
    Promise.resolve({ status: "ok" as const, delivered: true, summary: "skipped" }),
}));

const canvasFrontmatter = {
  "primary-engine": "json-canvas",
  "required-artifacts": "board.canvas",
  "required-validators": JSON_CANVAS_VALIDATOR_ID,
  "delivery-blocked-until": "validator_passed",
  "generation-stage-tools": "read,write,edit",
  "delivery-stage-tools": "message,sessions_send",
  triggers: "canvas",
  "allowed-tools": "read,write,edit,message",
};

const validCanvas =
  '{"nodes":[{"id":"n1","type":"text","x":0,"y":0,"width":1,"height":1}],"edges":[]}';
const AGENT = "canary-canvas";
const SESSION = `agent:${AGENT}:main`;
const IDLE_LAST_USER = 1_000;

function preflightFor(taskId: string) {
  return buildExecutionPreflight({
    taskId,
    sessionId: SESSION,
    message: "请做一个 canvas",
    skills: [{ name: "json-canvas", frontmatter: canvasFrontmatter }],
    policyToolNames: ["read", "write", "edit", "message", "exec"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-hook",
    name: "canary",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "at", at: "2026-01-01T00:00:00.000Z" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "canvas" },
    agentId: AGENT,
    delivery: { mode: "none", surfaces: ["workbench-agent-main"] },
    ...overrides,
  };
}

function layout() {
  const root = mkdtempSync(path.join(tmpdir(), "openbot-hook-surface-"));
  const workspace = path.join(root, "workspace");
  const store = path.join(root, "sessions", "sessions.json");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.dirname(store), { recursive: true });
  const cfg = {
    session: { store, mainKey: "main" },
    agents: {
      list: [{ id: AGENT, default: true, workspace }],
    },
  };
  return { root, workspace, store, cfg };
}

async function surfaceHook(params: {
  cfg: ReturnType<typeof layout>["cfg"];
  workspace: string;
  taskId?: string;
  summary?: string;
  jobId?: string;
  cronRunId?: string;
  tenantId?: string;
  hookDelivery?: HookDeliveryResult;
  validatorsRequired?: boolean;
}) {
  return surfaceCronJobResult({
    cfg: params.cfg,
    job: job({
      id: params.jobId ?? "job-hook",
      ...(params.taskId ? { conversationTaskId: params.taskId } : {}),
      ...(params.tenantId ? { ownership: { tenantId: params.tenantId } } : {}),
    }),
    agentId: AGENT,
    runId: params.taskId,
    cronRunId: params.cronRunId ?? "isolated-session",
    ingress: "hook",
    isolatedSessionId: "isolated-session",
    workspaceDir: params.workspace,
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    ...(params.hookDelivery ? { hookDelivery: params.hookDelivery } : {}),
    ...(params.validatorsRequired ? { validatorsRequired: true } : {}),
    nowMs: IDLE_LAST_USER + 5 * 60 * 60 * 1000,
    lastUserAtMs: IDLE_LAST_USER,
    result: { status: "ok", summary: params.summary ?? "进度更新" },
  });
}

function evidenceFor(task: ReturnType<typeof preflightFor>, workspace: string) {
  return toHookDeliveryResult({
    preflight: task,
    evidence: resolveAttemptDelivery({ preflight: task, workspaceDir: workspace }),
  });
}

describe("hook surface session delivery", () => {
  const previous = process.env.OPENBOT_CANARY_VALIDATORS;
  const roots: string[] = [];

  beforeEach(() => {
    process.env.OPENBOT_CANARY_VALIDATORS = JSON_CANVAS_VALIDATOR_ID;
    setProductionValidatorRegistrationForTest(true);
    resetCompletionHoldsForTest();
    resetDeliveryArtifactsForTest();
    resetValidationStateForTest();
    resetExecutionTraceForTest();
    clearSessionStoreCaches();
    vi.mocked(callGateway).mockReset();
    vi.mocked(callGateway).mockResolvedValue({ ok: true });
    hookBridge.run = null;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPENBOT_CANARY_VALIDATORS;
    } else {
      process.env.OPENBOT_CANARY_VALIDATORS = previous;
    }
    setProductionValidatorRegistrationForTest(true);
    clearSessionStoreCaches();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates one legal main-session identity for a hook run", async () => {
    const env = layout();
    roots.push(env.root);
    const ensured = await ensureHookSurfaceTranscript({
      cfg: env.cfg,
      agentId: AGENT,
      sessionKey: SESSION,
      workspaceDir: env.workspace,
      tenantId: "tenant-canary",
    });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) {
      return;
    }
    const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
      string,
      { sessionId?: string; sessionFile?: string; origin?: { accountId?: string } }
    >;
    expect(store[SESSION]?.sessionId).toBe(ensured.sessionId);
    expect(store[SESSION]?.sessionFile).toBe(ensured.sessionFile);
    expect(store[SESSION]?.origin?.accountId).toBe("tenant-canary");
    const fs = await import("node:fs");
    const sessionsDir = fs.realpathSync(path.dirname(env.store));
    const relative = path.relative(sessionsDir, fs.realpathSync(ensured.sessionFile));
    expect(relative.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  });

  it("creates an injectable transcript on the first hook surface", async () => {
    const env = layout();
    roots.push(env.root);
    const sent = await surfaceHook({ cfg: env.cfg, workspace: env.workspace, summary: "进度更新" });
    expect(sent).toEqual([SESSION]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
      string,
      { sessionFile?: string }
    >;
    const file = store[SESSION]?.sessionFile ?? "";
    const header = JSON.parse(readFileSync(file, "utf8").split("\n")[0] ?? "") as {
      type?: string;
      cwd?: string;
    };
    expect(header.type).toBe("session");
    expect(header.cwd).toBe(env.workspace);
  });

  it("delivers a completion only after a verified receipt", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const task = preflightFor("task-hook-ok");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    armCompletionHold({
      keys: [SESSION],
      preflight: task,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((event) => {
      if (event.data.phase === "hook_surface_delivery") {
        events.push(event.data);
      }
    });
    vi.mocked(callGateway).mockImplementation(async () => {
      const traces = readExecutionTraces(task.taskId);
      expect(traces.some((row) => row.decisionCode === "delivery_receipt_verified")).toBe(true);
      expect(hasDeliveryContext(task.taskId)).toBe(true);
      expect(traces.some((row) => row.transportOutcome === "ok")).toBe(false);
      return { ok: true };
    });
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      taskId: task.taskId,
      summary: "任务已完成",
    });
    stop();
    expect(sent).toEqual([SESSION]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(task.taskId)).toBe(false);
    const delivered = events.find((row) => row.transportOutcome === "ok");
    expect(delivered?.cleanupReason).toBe("delivered");
    expect(delivered?.decisionCode).toBe("delivery_receipt_verified");
    expect(delivered?.validatorId).toBe(JSON_CANVAS_VALIDATOR_ID);
    expect(delivered?.artifactSha256).toEqual(expect.any(String));
    expect(JSON.stringify(delivered)).not.toContain("board.canvas");
    expect(JSON.stringify(delivered)).not.toContain(validCanvas);
  });

  it("does not call transport when the receipt is missing", async () => {
    const env = layout();
    roots.push(env.root);
    const task = preflightFor("task-hook-missing");
    armCompletionHold({ keys: [SESSION], preflight: task, ttlMs: 60_000 });
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      taskId: task.taskId,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(task.taskId)).toBe(true);
    const file = path.join(path.dirname(env.store), "");
    const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
      string,
      { sessionFile?: string }
    >;
    const transcript = readFileSync(store[SESSION]?.sessionFile ?? "", "utf8");
    expect(transcript).not.toContain("任务已完成");
    expect(file).not.toContain("任务已完成");
  });

  it("creates the header when a legal session has no transcript yet", async () => {
    const env = layout();
    roots.push(env.root);
    const sessionId = "11111111-1111-4111-8111-111111111111";
    writeFileSync(env.store, JSON.stringify({ [SESSION]: { sessionId, updatedAt: 1 } }));
    clearSessionStoreCaches();
    const sent = await surfaceHook({ cfg: env.cfg, workspace: env.workspace });
    expect(sent).toEqual([SESSION]);
    const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
      string,
      { sessionId?: string; sessionFile?: string }
    >;
    expect(store[SESSION]?.sessionId).toBe(sessionId);
    expect(readFileSync(store[SESSION]?.sessionFile ?? "", "utf8")).toContain(sessionId);
    expect(callGateway).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown session key", async () => {
    const env = layout();
    roots.push(env.root);
    const ensured = await ensureHookSurfaceTranscript({
      cfg: env.cfg,
      agentId: AGENT,
      sessionKey: `agent:${AGENT}:side`,
      workspaceDir: env.workspace,
    });
    expect(ensured).toEqual({ ok: false, reason: "session_key_rejected" });
    const names = await import("node:fs").then((fs) => fs.readdirSync(path.dirname(env.store)));
    expect(names.some((name) => name.endsWith(".jsonl"))).toBe(false);
  });

  it("rejects another agent's session key", async () => {
    const env = layout();
    roots.push(env.root);
    const ensured = await ensureHookSurfaceTranscript({
      cfg: env.cfg,
      agentId: AGENT,
      sessionKey: "agent:other-agent:main",
      workspaceDir: env.workspace,
    });
    expect(ensured).toEqual({ ok: false, reason: "session_key_rejected" });
  });

  it("rejects another tenant on the same session key", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(
      env.store,
      JSON.stringify({
        [SESSION]: {
          sessionId: "22222222-2222-4222-8222-222222222222",
          updatedAt: 1,
          origin: { accountId: "tenant-a" },
        },
      }),
    );
    clearSessionStoreCaches();
    const ensured = await ensureHookSurfaceTranscript({
      cfg: env.cfg,
      agentId: AGENT,
      sessionKey: SESSION,
      workspaceDir: env.workspace,
      tenantId: "tenant-b",
    });
    expect(ensured).toEqual({ ok: false, reason: "tenant_mismatch" });
    const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
      string,
      { origin?: { accountId?: string }; sessionFile?: string }
    >;
    expect(store[SESSION]?.origin?.accountId).toBe("tenant-a");
    expect(store[SESSION]?.sessionFile).toBeUndefined();
  });

  it("rejects a session file that escapes the sessions directory", async () => {
    const env = layout();
    roots.push(env.root);
    const outside = path.join(env.root, "escaped.jsonl");
    writeFileSync(
      env.store,
      JSON.stringify({
        [SESSION]: {
          sessionId: "33333333-3333-4333-8333-333333333333",
          updatedAt: 1,
          sessionFile: outside,
        },
      }),
    );
    clearSessionStoreCaches();
    const ensured = await ensureHookSurfaceTranscript({
      cfg: env.cfg,
      agentId: AGENT,
      sessionKey: SESSION,
      workspaceDir: env.workspace,
    });
    expect(ensured).toEqual({ ok: false, reason: "path_rejected" });
    const fs = await import("node:fs");
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("keeps one header when two first writes race", async () => {
    const env = layout();
    roots.push(env.root);
    const [first, second] = await Promise.all([
      ensureHookSurfaceTranscript({
        cfg: env.cfg,
        agentId: AGENT,
        sessionKey: SESSION,
        workspaceDir: env.workspace,
      }),
      ensureHookSurfaceTranscript({
        cfg: env.cfg,
        agentId: AGENT,
        sessionKey: SESSION,
        workspaceDir: env.workspace,
      }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.sessionId).toBe(second.sessionId);
    const lines = readFileSync(first.sessionFile, "utf8")
      .split("\n")
      .filter((line) => line.trim());
    expect(lines).toHaveLength(1);
    const left = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-race-a",
      cronRunId: "run-a",
    });
    const right = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-race-b",
      cronRunId: "run-b",
    });
    expect(left).toEqual([SESSION]);
    expect(right).toEqual([SESSION]);
    expect(callGateway).toHaveBeenCalledTimes(2);
  });

  it("does not append the same completion twice", async () => {
    const env = layout();
    roots.push(env.root);
    vi.mocked(callGateway).mockImplementation(async (request) => {
      const params = request.params as {
        sessionKey?: string;
        cronJobId?: string;
        cronRunId?: string;
      };
      const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
        string,
        { sessionFile?: string }
      >;
      const file = store[params.sessionKey ?? ""]?.sessionFile;
      if (file) {
        writeFileSync(
          file,
          `${readFileSync(file, "utf8")}${JSON.stringify({
            message: {
              openclawCronResult: { jobId: params.cronJobId, runId: params.cronRunId },
            },
          })}\n`,
          "utf8",
        );
      }
      return { ok: true };
    });
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-idem",
      cronRunId: "run-idem",
    });
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-idem",
      cronRunId: "run-idem",
    });
    expect(callGateway).toHaveBeenCalledTimes(1);
    const traces = readExecutionTraces("job-idem");
    expect(traces.some((row) => row.transportOutcome === "already_delivered")).toBe(true);
  });

  it("keeps delivery context when transport fails", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const task = preflightFor("task-hook-fail");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    armCompletionHold({
      keys: [SESSION],
      preflight: task,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    vi.mocked(callGateway).mockRejectedValueOnce(new Error("transport down"));
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      taskId: task.taskId,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(hasDeliveryContext(task.taskId)).toBe(true);
    const traces = readExecutionTraces(task.taskId);
    expect(
      traces.some((row) => row.transportOutcome === "failed" && row.cleanupReason === "retained"),
    ).toBe(true);
  });

  it("clears only the task whose transport succeeded", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const kept = preflightFor("task-hook-keep");
    const done = preflightFor("task-hook-done");
    noteDeliveryArtifactPath(done.taskId, done.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: done, workspaceDir: env.workspace });
    armCompletionHold({ keys: [SESSION], preflight: kept, ttlMs: 60_000 });
    armCompletionHold({
      keys: [SESSION],
      preflight: done,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      taskId: done.taskId,
      summary: "任务已完成",
    });
    expect(hasDeliveryContext(done.taskId)).toBe(false);
    expect(hasDeliveryContext(kept.taskId)).toBe(true);
  });

  it("does not cross two tasks that share the session", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const left = preflightFor("task-hook-left");
    const right = preflightFor("task-hook-right");
    for (const task of [left, right]) {
      noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
      runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
      armCompletionHold({
        keys: [SESSION],
        preflight: task,
        workspaceDir: env.workspace,
        ttlMs: 60_000,
      });
    }
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      taskId: left.taskId,
      jobId: "job-left",
      cronRunId: "run-left",
      summary: "任务已完成",
    });
    expect(hasDeliveryContext(left.taskId)).toBe(false);
    expect(hasDeliveryContext(right.taskId)).toBe(true);
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      taskId: right.taskId,
      jobId: "job-right",
      cronRunId: "run-right",
      summary: "任务已完成",
    });
    expect(hasDeliveryContext(right.taskId)).toBe(false);
    const ids = vi.mocked(callGateway).mock.calls.map((call) => {
      const params = call[0]?.params as { cronJobId?: string };
      return params.cronJobId;
    });
    expect(ids).toEqual(["job-left", "job-right"]);
  });

  it("leaves ordinary cron surfacing unchanged", async () => {
    const env = layout();
    roots.push(env.root);
    const sent = await surfaceCronJobResult({
      cfg: env.cfg,
      job: job({ id: "job-ordinary", agentId: "ordinary" }),
      agentId: "ordinary",
      result: { status: "ok", summary: "任务已完成" },
      nowMs: IDLE_LAST_USER + 5 * 60 * 60 * 1000,
      lastUserAtMs: IDLE_LAST_USER,
    });
    expect(sent).toEqual(["agent:ordinary:main"]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    const fs = await import("node:fs");
    expect(fs.existsSync(env.store)).toBe(false);
    expect(fs.readdirSync(path.dirname(env.store)).some((name) => name.endsWith(".jsonl"))).toBe(
      false,
    );
  });

  it("reaches the transport from the hook HTTP entry", async () => {
    const env = layout();
    roots.push(env.root);
    let seen: { jobId: string; sessionKey: string; sent?: string[]; error?: string } | undefined;
    hookBridge.run = async (params) => {
      const next: { jobId: string; sessionKey: string; sent?: string[]; error?: string } = {
        jobId: params.job.id,
        sessionKey: params.sessionKey ?? "",
      };
      try {
        next.sent = await surfaceCronJobResult({
          cfg: env.cfg,
          job: {
            ...job({ id: params.job.id, agentId: params.job.agentId }),
          },
          agentId: params.job.agentId ?? AGENT,
          ingress: "hook",
          isolatedSessionId: "isolated-from-hook",
          workspaceDir: env.workspace,
          cronRunId: "isolated-from-hook",
          nowMs: IDLE_LAST_USER + 5 * 60 * 60 * 1000,
          lastUserAtMs: IDLE_LAST_USER,
          result: { status: "ok", summary: "进度更新" },
        });
      } catch (err) {
        next.error = err instanceof Error ? err.message : String(err);
      }
      seen = next;
      return { status: "ok", delivered: true, summary: "进度更新" };
    };
    const handler = createGatewayHooksRequestHandler({
      deps: {} as never,
      bindHost: "127.0.0.1",
      port: 0,
      logHooks: createSubsystemLogger("hook-surface-test"),
      getHooksConfig: () => ({
        basePath: "/hooks",
        token: "hook-test-token",
        maxBodyBytes: 256 * 1024,
        mappings: [],
        agentPolicy: {
          defaultAgentId: AGENT,
          knownAgentIds: new Set([AGENT]),
          allowedAgentIds: new Set([AGENT]),
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
        headers: {
          Authorization: "Bearer hook-test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "ping", name: "canary", agentId: AGENT }),
      });
      const body = (await response.json()) as { ok?: boolean; runId?: string };
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      await vi.waitFor(() => {
        expect(seen?.jobId).toBe(body.runId);
      });
      expect(seen?.error).toBeUndefined();
      expect(seen?.sent).toEqual([SESSION]);
      expect(seen?.sessionKey.startsWith("hook:")).toBe(true);
      expect(callGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "chat.inject",
          params: expect.objectContaining({ sessionKey: SESSION, cronJobId: body.runId }),
        }),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("sends once when the same attempt verified the receipt", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const task = preflightFor("task-structured-ok");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    armCompletionHold({
      keys: [SESSION],
      preflight: task,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    const delivery = evidenceFor(task, env.workspace);
    expect(delivery.decisionCode).toBe("delivery_receipt_verified");
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    expect(sent).toEqual([SESSION]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(task.taskId)).toBe(false);
    const trace = readExecutionTraces(task.taskId).find(
      (row) => row.decisionStage === "hook_surface" && row.transportOutcome === "ok",
    );
    expect(trace?.decisionCode).toBe("delivery_receipt_verified");
    expect(trace?.transportOutcome).toBe("ok");
    expect(trace?.cleanupReason).toBe("delivered");
  });

  it("does not call transport when the artifact is missing", async () => {
    const env = layout();
    roots.push(env.root);
    const task = preflightFor("task-structured-missing");
    armCompletionHold({ keys: [SESSION], preflight: task, ttlMs: 60_000 });
    const delivery = evidenceFor(task, env.workspace);
    expect(delivery.decisionCode).toBe("delivery_blocked");
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(task.taskId)).toBe(true);
    const trace = readExecutionTraces(task.taskId).find(
      (row) => row.decisionStage === "hook_surface",
    );
    expect(trace?.transportOutcome).toBe("blocked");
    expect(trace?.cleanupReason).toBe("retained");
  });

  it.each([
    ["illegal JSON", "{"],
    [
      "a bad edge",
      '{"nodes":[{"id":"n1","type":"text","x":0,"y":0,"width":1,"height":1}],"edges":[{"id":"e1","fromNode":"missing","toNode":"gone"}]}',
    ],
    ["an oversized canvas", "x".repeat(JSON_CANVAS_MAX_BYTES + 1)],
  ])("does not call transport for %s", async (_label, body) => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), body);
    const task = preflightFor(`task-structured-${_label}`);
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    armCompletionHold({ keys: [SESSION], preflight: task, ttlMs: 60_000 });
    const delivery = evidenceFor(task, env.workspace);
    expect(delivery.decisionCode).toBe("validation_failed");
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("does not call transport when the artifact changed after the receipt", async () => {
    const env = layout();
    roots.push(env.root);
    const file = path.join(env.workspace, "board.canvas");
    writeFileSync(file, validCanvas);
    const task = preflightFor("task-structured-changed");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    writeFileSync(file, `${validCanvas} `);
    armCompletionHold({ keys: [SESSION], preflight: task, ttlMs: 60_000 });
    const delivery = evidenceFor(task, env.workspace);
    expect(delivery.decisionCode).toBe("artifact_changed");
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(task.taskId)).toBe(true);
  });

  it("does not call transport when the validator is not registered", async () => {
    setProductionValidatorRegistrationForTest(false);
    const env = layout();
    roots.push(env.root);
    const task = preflightFor("task-structured-unregistered");
    armCompletionHold({ keys: [SESSION], preflight: task, ttlMs: 60_000 });
    const delivery = evidenceFor(task, env.workspace);
    expect(delivery.decisionCode).toBe("validator_unavailable");
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("keeps the task when transport throws", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const task = preflightFor("task-structured-throw");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    armCompletionHold({
      keys: [SESSION],
      preflight: task,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    vi.mocked(callGateway).mockRejectedValueOnce(new Error("inject down"));
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      hookDelivery: evidenceFor(task, env.workspace),
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(hasDeliveryContext(task.taskId)).toBe(true);
    const trace = readExecutionTraces(task.taskId).find(
      (row) => row.decisionStage === "hook_surface" && row.transportOutcome === "failed",
    );
    expect(trace?.decisionCode).toBe("delivery_receipt_verified");
    expect(trace?.transportOutcome).toBe("failed");
    expect(trace?.cleanupReason).toBe("retained");
  });

  it("clears only the task named by the structured result", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const done = preflightFor("task-structured-a");
    const kept = preflightFor("task-structured-b");
    noteDeliveryArtifactPath(done.taskId, done.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: done, workspaceDir: env.workspace });
    armCompletionHold({
      keys: [SESSION],
      preflight: done,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    armCompletionHold({ keys: [SESSION], preflight: kept, ttlMs: 60_000 });
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-a",
      cronRunId: "run-a",
      hookDelivery: evidenceFor(done, env.workspace),
      summary: "任务已完成",
    });
    expect(hasDeliveryContext(done.taskId)).toBe(false);
    expect(hasDeliveryContext(kept.taskId)).toBe(true);
    expect(callGateway).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a validator skill has no structured result", async () => {
    const env = layout();
    roots.push(env.root);
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      validatorsRequired: true,
      summary: "任务已完成",
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("keeps the current path for an ordinary hook task", async () => {
    const env = layout();
    roots.push(env.root);
    const sent = await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      summary: "进度更新",
    });
    expect(sent).toEqual([SESSION]);
    expect(callGateway).toHaveBeenCalledTimes(1);
  });

  it("does not send or clear the same job twice", async () => {
    const env = layout();
    roots.push(env.root);
    writeFileSync(path.join(env.workspace, "board.canvas"), validCanvas);
    const task = preflightFor("task-structured-retry");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, "board.canvas");
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: env.workspace });
    armCompletionHold({
      keys: [SESSION],
      preflight: task,
      workspaceDir: env.workspace,
      ttlMs: 60_000,
    });
    const delivery = evidenceFor(task, env.workspace);
    vi.mocked(callGateway).mockImplementation(async (request) => {
      const params = request.params as {
        sessionKey?: string;
        cronJobId?: string;
        cronRunId?: string;
      };
      const store = JSON.parse(readFileSync(env.store, "utf8")) as Record<
        string,
        { sessionFile?: string }
      >;
      const file = store[params.sessionKey ?? ""]?.sessionFile;
      if (file) {
        writeFileSync(
          file,
          `${readFileSync(file, "utf8")}${JSON.stringify({
            message: { openclawCronResult: { jobId: params.cronJobId, runId: params.cronRunId } },
          })}\n`,
          "utf8",
        );
      }
      return { ok: true };
    });
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-retry",
      cronRunId: "run-retry",
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    await surfaceHook({
      cfg: env.cfg,
      workspace: env.workspace,
      jobId: "job-retry",
      cronRunId: "run-retry",
      hookDelivery: delivery,
      summary: "任务已完成",
    });
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(task.taskId)).toBe(false);
    const delivered = readExecutionTraces(task.taskId).filter(
      (row) => row.cleanupReason === "delivered",
    );
    expect(delivered).toHaveLength(1);
  });
});
