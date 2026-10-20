/**
 * Build a READ_ONLY DiagnosticRun from session JSONL metadata + skill events.
 * Never copies message bodies or Evidence payloads into the RPC result.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  resolveDefaultSessionStorePath,
  resolveSessionFilePath,
} from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import { readSkillInvocationEvents } from "../gateway/skill-invocation/event-store.js";
import type { SkillInvocationEvent } from "../gateway/skill-invocation/types.js";
import { budgetForEnterpriseMode } from "./diagnose-policy.js";
import { diagnose, type DiagnoseOutput } from "./diagnose.js";
import { buildCompositeDiagnosisReportFromDiagnoseOutput } from "./report-query-projection-snapshot.js";
import type { DiagnosisStorePaths } from "./store-readers.js";
import type {
  DiagnosticPrincipal,
  DiagnosticRun,
  DiagnosticRunMode,
  DiagnosticTarget,
  TrustedTenantContext,
} from "./types.js";

export type LiveDiagnoseTarget = {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  runId?: string | null;
  sessionFilePath?: string;
};

export type LiveDiagnoseSummary = {
  reportId: string;
  completion: string;
  findingCount: number;
  findings: Array<{ findingId: string; severity: string; status: string; code?: string }>;
};

export function attachSessionFileIfPresent(target: LiveDiagnoseTarget): LiveDiagnoseTarget {
  try {
    const storePath = resolveDefaultSessionStorePath(target.agentId);
    const store = loadSessionStore(storePath, { skipCache: true });
    const entry = store[target.sessionKey];
    if (!entry?.sessionId) {
      return target;
    }
    const sessionFilePath = resolveSessionFilePath(entry.sessionId, entry, {
      agentId: target.agentId,
    });
    if (sessionFilePath && fs.existsSync(sessionFilePath)) {
      return { ...target, sessionId: entry.sessionId, sessionFilePath };
    }
    return { ...target, sessionId: entry.sessionId };
  } catch {
    return target;
  }
}

export function hashSessionKey(sessionKey: string): string {
  return `sha256:${createHash("sha256").update(sessionKey).digest("hex")}`;
}

export function buildLiveDiagnosticRun(input: {
  target: LiveDiagnoseTarget;
  trusted: TrustedTenantContext;
  requestedBy: DiagnosticPrincipal;
  now?: Date;
  mode?: DiagnosticRunMode;
}): DiagnosticRun {
  const now = input.now ?? new Date();
  const sessionKeyHash = hashSessionKey(input.target.sessionKey);
  const tenantId = input.trusted.tenantId;
  const runId = `diag-live-${createHash("sha256")
    .update(`${input.target.agentId}:${input.target.sessionKey}:${now.toISOString()}`)
    .digest("hex")
    .slice(0, 16)}`;
  const diagnosedAgentRunId = input.target.runId?.trim() || null;
  const sharedScope = {
    agentId: input.target.agentId,
    sessionKeyHash,
  };
  const sessionTarget: DiagnosticTarget = {
    schemaVersion: 1,
    targetType: "session",
    targetId: input.target.sessionId?.trim() || input.target.sessionKey,
    tenantId,
    authority: "session_store",
    capability: "execute",
    scope: sharedScope,
  };
  const agentTarget: DiagnosticTarget = {
    schemaVersion: 1,
    targetType: "agent",
    targetId: input.target.agentId,
    tenantId,
    authority: "agent_runner",
    capability: "execute",
    scope: sharedScope,
  };
  const targets: DiagnosticTarget[] = [sessionTarget, agentTarget];
  if (diagnosedAgentRunId) {
    targets.push({
      schemaVersion: 1,
      targetType: "run",
      targetId: diagnosedAgentRunId,
      tenantId,
      authority: "agent_runner",
      capability: "execute",
      scope: sharedScope,
      parent: {
        targetType: "agent",
        targetId: input.target.agentId,
        authority: "agent_runner",
      },
    });
  }
  const mode = input.mode ?? "QUICK";
  return {
    schemaVersion: 1,
    runId,
    diagnosedAgentRunId,
    mode,
    targets,
    requestedBy: input.requestedBy,
    mutationPolicy: "READ_ONLY",
    budget:
      mode === "QUICK"
        ? { timeoutMs: 8000, maxDiagnosers: 3, modelCalls: 0 }
        : budgetForEnterpriseMode(mode === "FULL" ? "FULL" : "TARGETED"),
    status: "queued",
    missingEvidence: [],
    startedAt: now.toISOString(),
  };
}

export function selectSkillEventsForTarget(
  events: readonly SkillInvocationEvent[],
  target: LiveDiagnoseTarget,
): SkillInvocationEvent[] {
  return events.filter((event) => {
    if (target.runId && event.runId === target.runId) {
      return true;
    }
    if (event.agentId !== target.agentId) {
      return false;
    }
    return Boolean(event.sessionKey && event.sessionKey === target.sessionKey);
  });
}

export async function diagnoseLiveTarget(params: {
  target: LiveDiagnoseTarget;
  trusted: TrustedTenantContext;
  requestedBy: DiagnosticPrincipal;
  skillConfigDir?: string;
  mode?: DiagnosticRunMode;
  observedSinceMs?: number;
}): Promise<{ output: DiagnoseOutput; summary: LiveDiagnoseSummary }> {
  const stores: DiagnosisStorePaths = {
    ...(params.skillConfigDir ? { skillConfigDir: params.skillConfigDir } : {}),
    ...(typeof params.observedSinceMs === "number"
      ? { observedSinceMs: params.observedSinceMs }
      : {}),
    ...(params.target.sessionFilePath
      ? {
          sessionFile: {
            sessionFilePath: params.target.sessionFilePath,
            sessionId: params.target.sessionId?.trim() || params.target.sessionKey,
            sessionKeyHash: hashSessionKey(params.target.sessionKey),
            agentId: params.target.agentId,
          },
        }
      : {}),
  };
  const output = await diagnose({
    schemaVersion: 1,
    run: buildLiveDiagnosticRun({
      target: params.target,
      trusted: params.trusted,
      requestedBy: params.requestedBy,
      ...(params.mode ? { mode: params.mode } : {}),
    }),
    evidences: [],
    trusted: params.trusted,
    stores,
  });
  const report = buildCompositeDiagnosisReportFromDiagnoseOutput(output, params.trusted);
  return {
    output,
    summary: {
      reportId: report.reportId,
      completion: report.completion,
      findingCount: report.findings.length,
      findings: report.findings.slice(0, 12).map((finding) => ({
        findingId: finding.findingId,
        severity: finding.severity,
        status: finding.status,
        ...(finding.code ? { code: finding.code } : {}),
      })),
    },
  };
}

export function listRecentLiveDiagnoseTargets(params?: {
  limit?: number;
  tenantId?: string | null;
  skillConfigDir?: string;
  sinceMs?: number;
}): LiveDiagnoseTarget[] {
  const limit = Math.max(1, Math.min(params?.limit ?? 8, 16));
  const events = readSkillInvocationEvents({
    configDir: params?.skillConfigDir,
    limit: 400,
  });
  const seen = new Set<string>();
  const targets: LiveDiagnoseTarget[] = [];
  for (const event of [...events].toReversed()) {
    if (typeof params?.sinceMs === "number" && event.startedAt < params.sinceMs) {
      continue;
    }
    if (params?.tenantId != null && event.tenantId !== params.tenantId) {
      continue;
    }
    const sessionKey = event.sessionKey?.trim();
    const agentId = event.agentId?.trim();
    if (!sessionKey || !agentId) {
      continue;
    }
    const key = `${agentId}:${sessionKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({
      agentId,
      sessionKey,
      runId: event.runId ?? null,
    });
    if (targets.length >= limit) {
      break;
    }
  }
  return targets;
}
