import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendSkillInvocationEvent } from "../gateway/skill-invocation/event-store.js";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-live-diag-${Date.now()}`,
}));
vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  buildLiveDiagnosticRun,
  diagnoseLiveTarget,
  hashSessionKey,
  listRecentLiveDiagnoseTargets,
} = await import("./live-run.js");
const { configureDiagnosisScheduler, defaultDiagnosisTick, DEFAULT_DIAGNOSIS_TICK_SESSION_CAP } =
  await import("./diagnose-tick.js");

const TRUSTED = { tenantId: "tenant-live-a" as string | null };

describe("live diagnose", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    configureDiagnosisScheduler({
      enabled: process.env.OPENBOT_DIAGNOSIS_TICK !== "0",
      sessionCap: DEFAULT_DIAGNOSIS_TICK_SESSION_CAP,
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds a READ_ONLY run with hashed session key and no message body", () => {
    const run = buildLiveDiagnosticRun({
      target: {
        agentId: "agent-main",
        sessionKey: "agent:main:direct",
        runId: "run-1",
      },
      trusted: TRUSTED,
      requestedBy: {
        schemaVersion: 1,
        principalId: "op-1",
        kind: "user",
        tenantId: TRUSTED.tenantId,
      },
    });
    expect(run.mutationPolicy).toBe("READ_ONLY");
    expect(run.targets[0]?.scope.sessionKeyHash).toBe(hashSessionKey("agent:main:direct"));
    expect(JSON.stringify(run)).not.toContain("hello user");
    expect(run.diagnosedAgentRunId).toBe("run-1");
    expect(run.mode).toBe("QUICK");
    expect(run.budget).toEqual({ timeoutMs: 8000, maxDiagnosers: 3, modelCalls: 0 });
    const targeted = buildLiveDiagnosticRun({
      target: {
        agentId: "agent-main",
        sessionKey: "agent:main:direct",
      },
      trusted: TRUSTED,
      requestedBy: {
        schemaVersion: 1,
        principalId: "op-1",
        kind: "user",
        tenantId: TRUSTED.tenantId,
      },
      mode: "TARGETED",
    });
    expect(targeted.mode).toBe("TARGETED");
    expect(targeted.budget.maxDiagnosers).toBe(4);
  });

  it("lists recent skill-event sessions and persists a diagnose snapshot", async () => {
    appendSkillInvocationEvent(
      {
        type: "skill_invocation_completed",
        invocationId: "inv-1",
        skillId: "notes",
        skillVersion: "1",
        agentId: "agent-main",
        tenantId: TRUSTED.tenantId,
        userId: "u1",
        startedAt: Date.now(),
        completedAt: Date.now(),
        outcome: "success",
        latencyMs: 10,
        failureCategory: null,
        runId: "run-live-1",
        sessionKey: "agent:main:direct",
        businessOutcome: null,
        toolName: "notes",
      },
      tmpDir,
    );
    const targets = listRecentLiveDiagnoseTargets({
      limit: 4,
      tenantId: TRUSTED.tenantId,
      skillConfigDir: tmpDir,
    });
    expect(targets).toEqual([
      expect.objectContaining({
        agentId: "agent-main",
        sessionKey: "agent:main:direct",
        runId: "run-live-1",
      }),
    ]);
    const stale = listRecentLiveDiagnoseTargets({
      limit: 4,
      tenantId: TRUSTED.tenantId,
      skillConfigDir: tmpDir,
      sinceMs: Date.now() + 60_000,
    });
    expect(stale).toEqual([]);
    const { summary } = await diagnoseLiveTarget({
      target: targets[0],
      trusted: TRUSTED,
      requestedBy: {
        schemaVersion: 1,
        principalId: "op-1",
        kind: "user",
        tenantId: TRUSTED.tenantId,
      },
      skillConfigDir: tmpDir,
    });
    expect(summary.reportId).toMatch(/^cdr-/);
    expect(summary.completion).toBeTruthy();
    const snapshotDir = path.join(tmpDir, "diagnosis-projections", TRUSTED.tenantId!);
    expect(fs.existsSync(snapshotDir)).toBe(true);
    expect(fs.readdirSync(snapshotDir).length).toBeGreaterThan(0);
  });

  it("diagnosis.diagnose RPC returns a summary without evidence payloads", async () => {
    appendSkillInvocationEvent(
      {
        type: "skill_invocation_completed",
        invocationId: "inv-rpc",
        skillId: "notes",
        skillVersion: "1",
        agentId: "agent-main",
        tenantId: TRUSTED.tenantId,
        userId: "u1",
        startedAt: Date.now(),
        completedAt: Date.now(),
        outcome: "success",
        latencyMs: 10,
        failureCategory: null,
        runId: "run-rpc-1",
        sessionKey: "agent:main:direct",
        businessOutcome: null,
        toolName: "notes",
      },
      tmpDir,
    );
    const { createDiagnosisReportGatewayHandlers } = await import("./report-query-gateway.js");
    const handlers = createDiagnosisReportGatewayHandlers(undefined, {
      resolveMembership: async () => ({ tenantId: TRUSTED.tenantId, userId: "op-1" }),
    });
    let captured: { ok: boolean; payload?: unknown; error?: { message: string } } | undefined;
    await handlers["diagnosis.diagnose"]({
      req: { type: "req", id: "test", method: "diagnosis.diagnose" } as never,
      params: { agentId: "agent-main", sessionKey: "agent:main:direct", runId: "run-rpc-1" },
      client: {
        user: "op-1",
        platformUserId: "op-1",
        sessionDomain: "enterprise",
      } as never,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        captured = {
          ok,
          payload,
          ...(error ? { error: { message: error.message } } : {}),
        };
      },
      context: {} as never,
    });
    expect(captured?.ok).toBe(true);
    const payload = captured?.payload as { reportId?: string; findings?: unknown[] };
    expect(payload.reportId).toMatch(/^cdr-/);
    expect(JSON.stringify(captured)).not.toContain("evidenceId");
    expect(JSON.stringify(captured)).not.toContain("hello user");
  });

  it("caps all-scope locators, defaults 24h TARGETED, and keeps Da Bai delivery closed", async () => {
    const { createDiagnosisReportGatewayHandlers } = await import("./report-query-gateway.js");
    const handlers = createDiagnosisReportGatewayHandlers(undefined, {
      resolveMembership: async () => ({ tenantId: TRUSTED.tenantId, userId: "op-1" }),
    });
    let captured: { ok: boolean; payload?: unknown } | undefined;
    await handlers["diagnosis.diagnose"]({
      req: { type: "req", id: "test", method: "diagnosis.diagnose" } as never,
      params: {
        scope: "all",
        window: "1y",
        mode: "QUICK",
        cadence: "off",
        deliverTo: { enterpriseAdmin: true, owners: true },
        targets: Array.from({ length: 12 }, (_, index) => ({
          agentId: `agent-${index}`,
          sessionKey: `agent:agent-${index}:main`,
        })),
      },
      client: {
        user: "op-1",
        platformUserId: "op-1",
        sessionDomain: "enterprise",
      } as never,
      isWebchatConnect: () => false,
      respond: (ok, payload) => {
        captured = { ok, payload };
      },
      context: {} as never,
    });
    expect(captured?.ok).toBe(true);
    const payload = captured?.payload as {
      windowId?: string;
      mode?: string;
      scanned?: number;
      skipped?: number;
      requestedCount?: number;
      delivery?: { delivered?: boolean; reason?: string; routes?: string[] };
    };
    expect(payload.windowId).toBe("24h");
    expect(payload.mode).toBe("TARGETED");
    expect(payload.requestedCount).toBe(12);
    expect(payload.skipped).toBe(4);
    expect(payload.scanned).toBeLessThanOrEqual(8);
    expect(payload.delivery?.delivered).toBe(false);
    expect(payload.delivery?.reason).toBe("daibai_delivery_gate_closed");
    expect(payload.delivery?.routes).toEqual(["enterprise", "employee"]);
    expect(JSON.stringify(captured)).not.toContain("chat.send");
  });

  it("does not invent an all-scope catalog from skill events", async () => {
    appendSkillInvocationEvent(
      {
        type: "skill_invocation_completed",
        invocationId: "inv-all-fallback",
        skillId: "notes",
        skillVersion: "1",
        agentId: "agent-main",
        tenantId: TRUSTED.tenantId,
        userId: "u1",
        startedAt: Date.now(),
        completedAt: Date.now(),
        outcome: "success",
        latencyMs: 10,
        failureCategory: null,
        runId: "run-all-fallback",
        sessionKey: "agent:main:direct",
        businessOutcome: null,
        toolName: "notes",
      },
      tmpDir,
    );
    const { createDiagnosisReportGatewayHandlers } = await import("./report-query-gateway.js");
    const handlers = createDiagnosisReportGatewayHandlers(undefined, {
      resolveMembership: async () => ({ tenantId: TRUSTED.tenantId, userId: "op-1" }),
    });
    let captured: { ok: boolean; payload?: unknown } | undefined;
    await handlers["diagnosis.diagnose"]({
      req: { type: "req", id: "test", method: "diagnosis.diagnose" } as never,
      params: { scope: "all" },
      client: {
        user: "op-1",
        platformUserId: "op-1",
        sessionDomain: "enterprise",
      } as never,
      isWebchatConnect: () => false,
      respond: (ok, payload) => {
        captured = { ok, payload };
      },
      context: {} as never,
    });
    const payload = captured?.payload as {
      reason?: string;
      scanned?: number;
      reportId?: string | null;
    };
    expect(captured?.ok).toBe(true);
    expect(payload.reason).toBe("no_session");
    expect(payload.scanned).toBe(0);
    expect(payload.reportId).toBeNull();
  });

  it("tick stays disabled when OPENBOT_DIAGNOSIS_TICK=0 and idle when no schedule exists", async () => {
    configureDiagnosisScheduler({ enabled: false });
    const result = await defaultDiagnosisTick();
    expect(result).toEqual({ ran: false, diagnosed: 0, summaries: [], reason: "disabled" });
    configureDiagnosisScheduler({ enabled: true, sessionCap: 2 });
    const idle = await defaultDiagnosisTick();
    expect(idle).toEqual({ ran: true, diagnosed: 0, summaries: [] });
  });
});
