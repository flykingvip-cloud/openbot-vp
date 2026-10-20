/**
 * Read-only adapters over injected PARTIAL rows.
 * Real Skill / Session JSONL readers live in store-readers.ts.
 * Adapters never append skill JSONL, emit route events, or write session / tool facts.
 */
import {
  computeAgentRuntimeHealth,
  type AgentRuntimeHealthFacts,
} from "../gateway/agent-runtime-health.js";
import {
  createRouteResolutionAdapterStub,
  type DiagnosisEvidenceAdapter,
  type EvidenceCollectResult,
} from "./adapters.js";
import { passthroughAttributionResolution } from "./attribution-passthrough.js";
import { getEvidenceSourceManifest } from "./catalog.js";
import {
  validateDiagnosticEvidence,
  type DiagnosticEvidence,
  type DiagnosticTarget,
  type EvidenceRequirement,
  type EvidenceSourceId,
  type TrustedTenantContext,
} from "./types.js";

export type SessionStoreRow = {
  sessionId: string;
  sessionKeyHash: string;
  agentId: string;
  messageReceived: boolean;
  retryCount: number;
  observedAt: string;
  authorityRecordId: string;
};

export type AgentRunnerRow = {
  agentId: string;
  runId: string | null;
  agentStarted: boolean;
  agentCompleted: boolean;
  errorClass: string | null;
  observedAt: string;
  authorityRecordId: string;
  complete?: boolean;
};

/** Shape aligned with SkillInvocationStarted/CompletedEvent — read side only. */
export type SkillInvocationSourceRow = {
  invocationId: string;
  skillId: string;
  skillVersion?: string;
  agentId: string;
  runId?: string | null;
  sessionKey?: string | null;
  outcome?: string | null;
  latencyMs?: number | null;
  toolName?: string | null;
  skillStarted: boolean;
  invocationCount?: number;
  attributionResolution?: unknown;
  observedAt: string;
};

export type ToolRuntimeRow = {
  toolNameClass: string;
  timeout: boolean;
  errorClass: string | null;
  latencyMs?: number | null;
  observedAt: string;
  authorityRecordId: string;
  runId?: string | null;
  toolCallId?: string | null;
};

export type PartialSourceBundle = {
  session?: readonly SessionStoreRow[];
  agentRunner?: readonly AgentRunnerRow[];
  skillInvocation?: readonly SkillInvocationSourceRow[];
  toolRuntime?: readonly ToolRuntimeRow[];
  agentHealth?: AgentRuntimeHealthFacts;
};

export function projectPartialRows(evidences: readonly DiagnosticEvidence[]): PartialSourceBundle {
  const session: SessionStoreRow[] = [];
  const agentRunner: AgentRunnerRow[] = [];
  const skillInvocation: SkillInvocationSourceRow[] = [];
  const toolRuntime: ToolRuntimeRow[] = [];
  let agentHealth: AgentRuntimeHealthFacts | undefined;
  for (const evidence of evidences) {
    const summary = evidence.summary;
    if (evidence.source === "session_store") {
      session.push({
        sessionId: evidence.target.targetId,
        sessionKeyHash: evidence.target.scope.sessionKeyHash ?? "",
        agentId: evidence.target.scope.agentId ?? "",
        messageReceived: summary.messageReceived === true,
        retryCount: typeof summary.retryCount === "number" ? summary.retryCount : 0,
        observedAt: evidence.observedAt,
        authorityRecordId: evidence.authorityRecordId,
      });
    } else if (evidence.source === "agent_runner") {
      agentRunner.push({
        agentId: evidence.target.scope.agentId ?? evidence.target.targetId,
        runId:
          typeof summary.agentRunId === "string" ? summary.agentRunId : evidence.target.targetId,
        agentStarted: summary.agentStarted === true,
        agentCompleted: summary.agentCompleted === true,
        errorClass: typeof summary.errorClass === "string" ? summary.errorClass : null,
        observedAt: evidence.observedAt,
        authorityRecordId: evidence.authorityRecordId,
        complete: evidence.collection.completeness === "complete",
      });
    } else if (evidence.source === "skill_invocation") {
      skillInvocation.push({
        invocationId: evidence.authorityRecordId,
        skillId: evidence.target.targetId,
        agentId: evidence.target.scope.agentId ?? "",
        skillStarted: summary.skillStarted === true,
        invocationCount: typeof summary.invocationCount === "number" ? summary.invocationCount : 1,
        outcome: typeof summary.outcome === "string" ? summary.outcome : null,
        latencyMs: typeof summary.latencyMs === "number" ? summary.latencyMs : null,
        attributionResolution:
          summary.attributionResolution ?? evidence.collection.attributionResolution,
        observedAt: evidence.observedAt,
      });
    } else if (evidence.source === "tool_runtime") {
      toolRuntime.push({
        toolNameClass:
          typeof summary.toolNameClass === "string" ? summary.toolNameClass : "unknown",
        timeout: summary.timeout === true,
        errorClass: typeof summary.errorClass === "string" ? summary.errorClass : null,
        latencyMs: typeof summary.latencyMs === "number" ? summary.latencyMs : null,
        observedAt: evidence.observedAt,
        authorityRecordId: evidence.authorityRecordId,
      });
    } else if (evidence.source === "agent_runtime_health") {
      agentHealth = {
        agentId: evidence.target.targetId,
        modelConfigured: summary.modelConfigured === true,
        boundChannels: [
          {
            channelId: "channel-fixture",
            accountId: "account-fixture",
            connected:
              (typeof summary.connectedChannelCount === "number"
                ? summary.connectedChannelCount
                : 0) > 0,
          },
        ],
      };
    }
  }
  return { session, agentRunner, skillInvocation, toolRuntime, agentHealth };
}

function emit(
  raw: Omit<DiagnosticEvidence, "schemaVersion">,
  trusted: TrustedTenantContext,
): DiagnosticEvidence {
  return validateDiagnosticEvidence({ schemaVersion: 1, ...raw }, trusted);
}

function fallbackTarget(
  request: EvidenceRequirement,
  ctx: TrustedTenantContext,
  targetId: string,
): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: request.targetType,
    targetId,
    tenantId: ctx.tenantId,
    authority: request.source,
    scope: {},
  };
}

export function createSessionStoreAdapter(
  rows: readonly SessionStoreRow[],
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("session_store");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: true,
    collect(request, ctx) {
      if (request.source !== "session_store") {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const evidences = rows.map((row) =>
        emit(
          {
            evidenceId: `ev-session-${row.sessionId}`,
            evidenceType: "event",
            source: "session_store",
            authority: manifest.authority,
            authorityRecordId: row.authorityRecordId,
            observedAt: row.observedAt,
            target: fallbackTarget(request, ctx, row.sessionId),
            summary: {
              messageReceived: row.messageReceived,
              retryCount: row.retryCount,
              sessionKeyHash: row.sessionKeyHash,
            },
            collection: {
              method: "query",
              completeness: "partial",
              attributionResolution: "not_applicable",
            },
            privacy: { classification: "internal", redacted: true },
          },
          ctx,
        ),
      );
      return Promise.resolve(collected(evidences, request));
    },
  };
}

export function createAgentRunnerAdapter(
  rows: readonly AgentRunnerRow[],
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("agent_runner");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: true,
    collect(request, ctx) {
      if (request.source !== "agent_runner") {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const evidences = rows.map((row) =>
        emit(
          {
            evidenceId: `ev-agent-${row.authorityRecordId}`,
            evidenceType: "event",
            source: "agent_runner",
            authority: manifest.authority,
            authorityRecordId: row.authorityRecordId,
            observedAt: row.observedAt,
            target: fallbackTarget(request, ctx, row.runId ?? row.agentId),
            summary: {
              agentStarted: row.agentStarted,
              agentCompleted: row.agentCompleted,
              errorClass: row.errorClass,
              agentRunId: row.runId,
            },
            collection: {
              method: "event_adapter",
              completeness: row.complete === true ? "complete" : "partial",
              attributionResolution: "not_applicable",
            },
            privacy: { classification: "internal", redacted: true },
          },
          ctx,
        ),
      );
      return Promise.resolve(collected(evidences, request));
    },
  };
}

export function createSkillInvocationReadAdapter(
  rows: readonly SkillInvocationSourceRow[],
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("skill_invocation");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: true,
    collect(request, ctx) {
      if (request.source !== "skill_invocation") {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const evidences = rows.map((row) => {
        const resolution = passthroughAttributionResolution(row.attributionResolution);
        return emit(
          {
            evidenceId: `ev-skill-${row.invocationId}`,
            evidenceType: "event",
            source: "skill_invocation",
            authority: manifest.authority,
            authorityRecordId: row.invocationId,
            observedAt: row.observedAt,
            target: fallbackTarget(request, ctx, row.skillId),
            summary: {
              skillStarted: row.skillStarted,
              invocationCount: row.invocationCount ?? (row.skillStarted ? 1 : 0),
              outcome: row.outcome ?? null,
              latencyMs: row.latencyMs ?? null,
              skillId: row.skillId,
              runId: row.runId ?? null,
              attributionResolution: resolution,
            },
            collection: {
              method: "query",
              completeness: "partial",
              attributionResolution: resolution,
            },
            privacy: { classification: "internal", redacted: true },
          },
          ctx,
        );
      });
      return Promise.resolve(collected(evidences, request));
    },
  };
}

export function createToolRuntimeAdapter(
  rows: readonly ToolRuntimeRow[],
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("tool_runtime");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: true,
    collect(request, ctx) {
      if (request.source !== "tool_runtime") {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const evidences = rows.map((row) =>
        emit(
          {
            evidenceId: `ev-tool-${row.authorityRecordId}`,
            evidenceType: "event",
            source: "tool_runtime",
            authority: manifest.authority,
            authorityRecordId: row.authorityRecordId,
            observedAt: row.observedAt,
            target: fallbackTarget(request, ctx, row.toolNameClass),
            summary: {
              toolNameClass: row.toolNameClass,
              timeout: row.timeout,
              errorClass: row.errorClass,
              latencyMs: row.latencyMs ?? null,
            },
            collection: {
              method: "event_adapter",
              completeness: "partial",
              attributionResolution: "not_applicable",
            },
            privacy: { classification: "internal", redacted: true },
          },
          ctx,
        ),
      );
      return Promise.resolve(collected(evidences, request));
    },
  };
}

export function createAgentRuntimeHealthAdapter(
  facts: AgentRuntimeHealthFacts | undefined,
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("agent_runtime_health");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: true,
    collect(request, ctx) {
      if (request.source !== "agent_runtime_health") {
        return Promise.resolve({ evidences: [], missing: [] });
      }
      if (!facts) {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const report = computeAgentRuntimeHealth(facts);
      const evidence = emit(
        {
          evidenceId: `ev-l1-${report.agentId}`,
          evidenceType: "snapshot",
          source: "agent_runtime_health",
          authority: manifest.authority,
          authorityRecordId: `agent-runtime-health:${report.agentId}`,
          observedAt: new Date(0).toISOString(),
          target: fallbackTarget(request, ctx, report.agentId),
          summary: {
            health: report.health,
            modelConfigured: report.modelConfigured,
            boundChannelCount: report.boundChannelCount,
            connectedChannelCount: report.connectedChannelCount,
            notPerRunRca: true,
          },
          collection: {
            method: "snapshot",
            completeness: "partial",
            attributionResolution: "not_applicable",
          },
          privacy: { classification: "internal", redacted: true },
        },
        ctx,
      );
      return Promise.resolve({ evidences: [evidence], missing: [] });
    },
  };
}

export function createPartialSourceAdapters(
  bundle: PartialSourceBundle,
): DiagnosisEvidenceAdapter[] {
  return [
    createSessionStoreAdapter(bundle.session ?? []),
    createAgentRunnerAdapter(bundle.agentRunner ?? []),
    createSkillInvocationReadAdapter(bundle.skillInvocation ?? []),
    createToolRuntimeAdapter(bundle.toolRuntime ?? []),
    createAgentRuntimeHealthAdapter(bundle.agentHealth),
    createRouteResolutionAdapterStub(),
  ];
}

export function adapterForSource(
  adapters: readonly DiagnosisEvidenceAdapter[],
  source: EvidenceSourceId,
): DiagnosisEvidenceAdapter | undefined {
  return adapters.find((adapter) => adapter.id === source);
}

function collected(
  evidences: readonly DiagnosticEvidence[],
  request: EvidenceRequirement,
): EvidenceCollectResult {
  if (evidences.length === 0 && request.required) {
    return { evidences: [], missing: [request] };
  }
  return { evidences, missing: [] };
}
