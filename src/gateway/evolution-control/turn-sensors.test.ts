import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  emitExecutionChainProvenance,
  resetExecutionChainProvenanceForTest,
} from "../../infra/execution-chain-provenance.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "../agent-growth/evolution-task-outcomes.js";
import { recordSkillInvocationCompleted } from "../skill-invocation/record.js";
import {
  inspectTaskBoundFailureMechanism,
  inspectTurnFailureMechanism,
  inspectTurnSensorsFromSkillInvocations,
} from "./turn-sensors.js";

const AGENT_ID = "sensor-bot";
const tmpDirs: string[] = [];

afterEach(() => {
  resetExecutionChainProvenanceForTest();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

describe("turn skill sensors", () => {
  it("leaves sensors unset when the turn has no skill invocations", () => {
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt: 1,
        endedAt: 2,
        configDir: tmpDir("evo-sensor-empty-"),
      }),
    ).toEqual({});
  });

  it("joins inspected skill invocations onto a windowed task outcome", () => {
    const configDir = tmpDir("evo-sensor-join-");
    const agentDir = tmpDir("evo-sensor-agent-");
    const endedAt = Date.parse("2026-09-06T11:06:20.000Z");
    recordSkillInvocationCompleted(
      {
        skillId: "skill-a",
        agentId: AGENT_ID,
        outcome: "success",
        completedAt: endedAt - 1_000,
        latencyMs: 20,
        failureCategory: null,
        tenantId: "tenant-bind-a",
      },
      { configDir },
    );
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir }] },
    } as unknown as OpenBotConfig;
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: endedAt,
        succeeded: true,
        latencyMs: 20_000,
      },
      { skillInvocationConfigDir: configDir },
    );
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]).toMatchObject({
      succeeded: true,
      latencyMs: 20_000,
      tenantId: "tenant-bind-a",
      securityViolation: false,
    });
  });

  it("does not invent security when latency is missing", () => {
    const configDir = tmpDir("evo-sensor-nolat-");
    const agentDir = tmpDir("evo-sensor-nolat-agent-");
    recordSkillInvocationCompleted(
      {
        skillId: "skill-a",
        agentId: AGENT_ID,
        outcome: "failure",
        completedAt: Date.parse("2026-09-06T11:06:00.000Z"),
        latencyMs: 10,
        failureCategory: "security",
        tenantId: "tenant-bind-a",
      },
      { configDir },
    );
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir }] },
    } as unknown as OpenBotConfig;
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: Date.parse("2026-09-06T11:06:20.000Z"),
        succeeded: false,
      },
      { skillInvocationConfigDir: configDir },
    );
    const row = readEvolutionTaskOutcomes(cfg, AGENT_ID)[0];
    expect(row?.securityViolation).toBeUndefined();
    expect(row?.tenantId).toBeUndefined();
  });

  it("joins exec/sandbox provenance from the same turn window", () => {
    const startedAt = Date.now();
    emitExecutionChainProvenance({
      kind: "exec_policy",
      capability: "exec",
      resource: { scope: "host_process_filesystem", target: "rm -rf /" },
      policy: {
        owner: "tools.exec",
        decision: "denied",
        reason: "exec denied: host=gateway security=deny",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "denied",
      effectObserved: "blocked",
      session_id: null,
      session_key: null,
      run_id: "run-sensor",
      tool_call_id: "tool-1",
    });
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt,
        endedAt: Date.now(),
        configDir: tmpDir("evo-sensor-prov-"),
        runId: "run-sensor",
      }),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      securityViolation: false,
    });
  });

  it("inspects chat-only turns as zero when runId and toolsObserved=0 are present", () => {
    const startedAt = Date.now();
    emitExecutionChainProvenance({
      kind: "mutation_attempt",
      tool: "write",
      tool_call_id: "tool-other-chat",
      session_id: null,
      session_key: null,
      run_id: "run-other-chat",
      resource: "secret.md",
      policy: {
        owner: "workspace-root-guard",
        decision: "denied",
        reason: "sandbox_boundary",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
    });
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt,
        endedAt: Date.now(),
        configDir: tmpDir("evo-sensor-chat-zero-"),
        runId: "run-chat-only",
        toolsObserved: 0,
      }),
    ).toEqual({ securityViolation: false });
  });

  it("records denied+applied as suspected bypass and does not invent a confirmed violation", () => {
    const startedAt = Date.now();
    emitExecutionChainProvenance({
      kind: "mutation_attempt",
      tool: "write",
      tool_call_id: "tool-applied",
      session_id: null,
      session_key: null,
      run_id: "run-applied",
      resource: "notes.md",
      policy: {
        owner: "workspace-root-guard",
        decision: "denied",
        reason: "sandbox_boundary",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
      effectObserved: "applied",
    });
    const endedAt = Date.now();
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt,
        endedAt,
        configDir: tmpDir("evo-sensor-suspected-"),
        runId: "run-applied",
        toolsObserved: 0,
      }),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
    });
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: tmpDir("evo-sensor-suspected-agent-") }] },
    } as unknown as OpenBotConfig;
    appendEvolutionTaskOutcome(cfg, {
      agentId: AGENT_ID,
      occurredAt: endedAt,
      succeeded: false,
      runId: "run-applied",
      latencyMs: endedAt - startedAt,
      toolsObserved: 0,
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]).toMatchObject({
      suspectedAuthorizationBypass: true,
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]?.securityViolation).toBeUndefined();
  });

  it("records denied+verified as a confirmed violation", () => {
    const startedAt = Date.now();
    emitExecutionChainProvenance({
      kind: "mutation_attempt",
      tool: "write",
      tool_call_id: "tool-verified",
      session_id: null,
      session_key: null,
      run_id: "run-verified",
      resource: "notes.md",
      policy: {
        owner: "workspace-root-guard",
        decision: "denied",
        reason: "sandbox_boundary",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
      effectObserved: "verified",
    });
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt,
        endedAt: Date.now(),
        configDir: tmpDir("evo-sensor-verified-"),
        runId: "run-verified",
      }),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
      securityViolation: true,
      authorizationBypass: true,
    });
  });

  it("leaves security unset when tools ran but no skill or provenance was inspected", () => {
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt: 1,
        endedAt: 2,
        configDir: tmpDir("evo-sensor-tools-uninspected-"),
        runId: "run-with-tools",
        toolsObserved: 2,
      }),
    ).toEqual({});
  });

  it("does not invent security for a tool-less turn without runId", () => {
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt: 1,
        endedAt: 2,
        configDir: tmpDir("evo-sensor-no-runid-"),
        toolsObserved: 0,
      }),
    ).toEqual({});
  });

  it("does not let another run's denied or bypass sensors contaminate this run", () => {
    const startedAt = Date.now();
    emitExecutionChainProvenance({
      kind: "mutation_attempt",
      tool: "write",
      tool_call_id: "tool-other",
      session_id: null,
      session_key: null,
      run_id: "run-other",
      resource: "secret.md",
      policy: {
        owner: "workspace-root-guard",
        decision: "denied",
        reason: "sandbox_boundary",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
    });
    expect(
      inspectTurnSensorsFromSkillInvocations({
        agentId: AGENT_ID,
        startedAt,
        endedAt: Date.now(),
        configDir: tmpDir("evo-sensor-iso-"),
        runId: "run-current",
      }),
    ).toEqual({});
  });

  it("records inspected-zero provenance without inventing a tenant", () => {
    const startedAt = Date.now();
    emitExecutionChainProvenance({
      kind: "mutation_attempt",
      tool: "write",
      tool_call_id: "tool-2",
      session_id: null,
      session_key: null,
      run_id: null,
      resource: "notes.md",
      policy: {
        owner: "workspace-root-guard",
        decision: "allowed",
        reason: "passed_existing_guard",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
      effectObserved: "applied",
    });
    const endedAt = Date.now();
    const agentDir = tmpDir("evo-sensor-prov-agent-");
    const cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir }] },
    } as unknown as OpenBotConfig;
    appendEvolutionTaskOutcome(cfg, {
      agentId: AGENT_ID,
      occurredAt: endedAt,
      succeeded: true,
      latencyMs: endedAt - startedAt,
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]).toMatchObject({
      securityViolation: false,
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]?.tenantId).toBeUndefined();
  });

  it("reads a unique trusted turn mechanism and ignores mixed or generic categories", () => {
    const configDir = tmpDir("evo-sensor-mech-");
    const endedAt = Date.parse("2026-09-06T12:00:20.000Z");
    recordSkillInvocationCompleted(
      {
        skillId: "skill-timeout",
        agentId: AGENT_ID,
        outcome: "failure",
        completedAt: endedAt - 500,
        latencyMs: 20,
        failureCategory: "timeout",
      },
      { configDir },
    );
    expect(
      inspectTurnFailureMechanism({
        agentId: AGENT_ID,
        startedAt: endedAt - 2_000,
        endedAt,
        configDir,
      }),
    ).toEqual({ cause: "timeout" });
    recordSkillInvocationCompleted(
      {
        skillId: "skill-security",
        agentId: AGENT_ID,
        outcome: "failure",
        completedAt: endedAt - 400,
        latencyMs: 20,
        failureCategory: "security",
      },
      { configDir },
    );
    expect(
      inspectTurnFailureMechanism({
        agentId: AGENT_ID,
        startedAt: endedAt - 2_000,
        endedAt,
        configDir,
      }),
    ).toBeUndefined();
    const genericDir = tmpDir("evo-sensor-mech-generic-");
    recordSkillInvocationCompleted(
      {
        skillId: "skill-generic",
        agentId: AGENT_ID,
        outcome: "failure",
        completedAt: endedAt - 100,
        latencyMs: 20,
        failureCategory: "tool_error",
      },
      { configDir: genericDir },
    );
    expect(
      inspectTurnFailureMechanism({
        agentId: AGENT_ID,
        startedAt: endedAt - 2_000,
        endedAt,
        configDir: genericDir,
      }),
    ).toBeUndefined();
  });

  it("binds review mechanisms by taskId and never by nearby time", () => {
    const configDir = tmpDir("evo-sensor-task-bind-");
    const completedAt = Date.parse("2026-09-06T12:10:00.000Z");
    recordSkillInvocationCompleted(
      {
        skillId: "skill-perm",
        agentId: AGENT_ID,
        outcome: "failure",
        completedAt,
        latencyMs: 20,
        failureCategory: "permission",
        taskId: "task-bound",
      },
      { configDir },
    );
    recordSkillInvocationCompleted(
      {
        skillId: "skill-other",
        agentId: AGENT_ID,
        outcome: "failure",
        completedAt: completedAt + 50,
        latencyMs: 20,
        failureCategory: "timeout",
        taskId: "task-other",
      },
      { configDir },
    );
    expect(inspectTaskBoundFailureMechanism({ taskId: "task-bound", configDir })).toEqual({
      cause: "permission",
    });
    expect(inspectTaskBoundFailureMechanism({ taskId: "task-missing", configDir })).toBeUndefined();
  });
});
