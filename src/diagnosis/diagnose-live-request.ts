/**
 * Execute a parsed enterprise diagnose request: locators, window, mode,
 * and optional explicit Da Bai conversation delivery.
 * diagnosis.diagnose never writes cadence. Cadence writes go through
 * diagnosis.schedule.apply only.
 */
import { loadConfig, type OpenBotConfig } from "../config/config.js";
import { resolveSharedSessionStorePath } from "../config/sessions/paths.js";
import type { AgentRegistryStore } from "../gateway/agent-registry/types.js";
import type { SkillInvocationEvent } from "../gateway/skill-invocation/types.js";
import { CONFIG_DIR } from "../utils.js";
import {
  deliverDiagnoseReportToConversation,
  type DiagnoseConversationOwnerResolver,
  type DiagnoseConversationSend,
} from "./diagnose-daibai-inbox.js";
import {
  buildDataPlaneArtifactsFromGrowth,
  type DataPlaneCase,
} from "./diagnose-data-plane-cases.js";
import { buildEvidenceSloArtifacts, mergeDataPlaneArtifacts } from "./diagnose-evidence-slo.js";
import { persistProducedEvolutionPreviews } from "./diagnose-evolution-preview-store.js";
import {
  expandDiagnoseGroupMembers,
  type ExpandMemberSource,
  type GroupMemberExpandResult,
} from "./diagnose-group-member-expand.js";
import { readDiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import type {
  DiagnoseGrowthAssessment,
  DiagnoseGrowthJobRef,
} from "./diagnose-growth-assessment.js";
import { persistGrowthAssessmentSnapshot } from "./diagnose-growth-snapshot.js";
import type { GrowthAssessmentSnapshot } from "./diagnose-growth-snapshot.js";
import {
  asEnterpriseDiagnoseMode,
  planDiagnosisDaibaiDelivery,
  type DiagnosisDeliveryPlan,
  type ParsedDiagnoseRequest,
} from "./diagnose-policy.js";
import { professionalReportId } from "./diagnose-professional-protocol.js";
import {
  buildProfessionalDiagnosisReport,
  formatProfessionalDiagnosisReport,
  type ProfessionalDiagnosisReport,
} from "./diagnose-report-text.js";
import {
  buildDiagnoseEvolutionPrescriptions,
  type DiagnoseEvolutionPrescription,
} from "./diagnose-self-evolution.js";
import {
  buildSkillInstallationPreviewFact,
  buildStructuralPreviewFact,
  type TrustedSkillInstallationBaseline,
  type TrustedSkillInstallationObservation,
  type TrustedStructuralBaseline,
  type TrustedStructuralObservation,
} from "./diagnose-structural-preview.js";
import {
  attachSessionFileIfPresent,
  diagnoseLiveTarget,
  listRecentLiveDiagnoseTargets,
  type LiveDiagnoseSummary,
} from "./live-run.js";
import type { SkillInstallationPreviewFact } from "./skill-installation-candidate.js";
import type { StructuralPreviewFact } from "./structural-evolution-candidate.js";
import {
  loadStructuralPreviewSources,
  type StructuralPreviewSources,
} from "./structural-preview-reader.js";
import type { DiagnosticPrincipal, TrustedTenantContext } from "./types.js";

export type DiagnoseExecutionPayload = Omit<LiveDiagnoseSummary, "reportId"> & {
  reportId: string | null;
  reason?: string;
  windowId: ParsedDiagnoseRequest["windowId"];
  mode: ParsedDiagnoseRequest["mode"];
  scope: ParsedDiagnoseRequest["scope"];
  scanned: number;
  skipped: number;
  requestedCount: number;
  cadence: ParsedDiagnoseRequest["cadence"];
  delivery: DiagnosisDeliveryPlan;
  reportIds: string[];
  growths?: DiagnoseGrowthAssessment[];
  prescriptions?: DiagnoseEvolutionPrescription[];
  professionalReport?: ProfessionalDiagnosisReport;
  reportText?: string;
};

export type LocatorStatus = "located" | "locator_failed" | "not_applicable";

export type LocatorFailureCode =
  | "catalog_miss"
  | "canonical_ambiguous"
  | "canonical_missing"
  | "acl_denied"
  | "acl_unavailable"
  | "resolve_failed"
  | "path_rejected";

export type GovernedGrowthRead = {
  agentId: string;
  tenantId: string;
  agentAssetId: string;
  targetOwnerId: string;
  displayName?: string;
  workspaceDir?: string | null;
  /** Track D / M1 — explicit locator outcome (never silent empty). */
  locatorStatus?: LocatorStatus;
  locatorFailureCode?: LocatorFailureCode;
  /** Safe detail only (groupId / agentId). No secrets or absolute internal paths. */
  locatorFailureDetail?: string;
  hadTaskActivity?: boolean;
  roleBaselineSkillIds?: string[];
  skillEvents?: readonly SkillInvocationEvent[];
  scopedJobs?: readonly DiagnoseGrowthJobRef[];
  authorizationRef?: string | null;
  /** Trusted A1 preview inputs. Only the server reader may set these. */
  structuralObservation?: TrustedStructuralObservation;
  structuralBaseline?: TrustedStructuralBaseline;
  structuralEvidenceRefs?: string[];
  skillInstallationObservation?: TrustedSkillInstallationObservation;
  skillInstallationBaseline?: TrustedSkillInstallationBaseline;
};

function mergeCompletion(values: readonly string[]): string {
  if (values.some((value) => value === "INCONCLUSIVE")) {
    return "INCONCLUSIVE";
  }
  if (values.some((value) => value === "SUSPECTED")) {
    return "SUSPECTED";
  }
  return values[values.length - 1] ?? "INCONCLUSIVE";
}

function emptyPayload(
  request: ParsedDiagnoseRequest,
  delivery: DiagnosisDeliveryPlan,
): DiagnoseExecutionPayload {
  return {
    reportId: null,
    completion: "INCONCLUSIVE",
    findingCount: 0,
    findings: [],
    reason: "no_session",
    windowId: request.windowId,
    mode: request.mode,
    scope: request.scope,
    scanned: 0,
    skipped: request.skipped,
    requestedCount: request.requestedCount,
    cadence: request.cadence,
    delivery,
    reportIds: [],
  };
}

/** Missing config fails closed to Preview=0. Diagnose itself still runs. */
export function loadStructuralPreviewConfig(): { cfg: OpenBotConfig } | undefined {
  try {
    return { cfg: loadConfig() };
  } catch {
    return undefined;
  }
}

export async function executeParsedDiagnoseRequest(input: {
  request: ParsedDiagnoseRequest;
  trusted: TrustedTenantContext;
  requestedBy: DiagnosticPrincipal;
  skillConfigDir?: string;
  now?: number;
  allowConversationDelivery?: boolean;
  /** Tick must pass false. Live confirm still stays behind the gray gate. */
  allowSelfEvolutionConfirm?: boolean;
  growthReads?: GovernedGrowthRead[];
  /**
   * Isolated or live agent dirs. Absent means no structural preview:
   * callers must not invent observation JSON.
   */
  structuralPreview?: {
    cfg: OpenBotConfig;
    sessionStorePath?: string;
  };
  /** Optional — enables group member expand on seal (Track D M1). */
  registry?: AgentRegistryStore;
  loadGroupMembers?: (groupId: string) => Promise<readonly ExpandMemberSource[] | null>;
  sessionKeyExists?: (agentId: string, sessionKey: string) => boolean;
  conversationSend?: DiagnoseConversationSend;
  resolveOwners?: DiagnoseConversationOwnerResolver;
}): Promise<DiagnoseExecutionPayload> {
  const now = input.now ?? Date.now();
  const skillConfigDir = input.skillConfigDir ?? CONFIG_DIR;
  const observedSinceMs = now - input.request.windowMs;
  let locators = input.request.locators;
  if (locators.length === 0 && input.request.scope === "target") {
    locators = listRecentLiveDiagnoseTargets({
      limit: 1,
      tenantId: input.trusted.tenantId,
      skillConfigDir,
      sinceMs: observedSinceMs,
    });
  }
  if (locators.length === 0) {
    const base = emptyPayload(input.request, planDiagnosisDaibaiDelivery(input.request.deliverTo));
    const sealed = sealReport(base, input.trusted.tenantId);
    return {
      ...sealed,
      delivery: await resolveExecutionDelivery({
        ...input,
        locators,
        payload: sealed,
      }),
    };
  }
  const summaries: LiveDiagnoseSummary[] = [];
  for (const locator of locators) {
    try {
      const { summary } = await diagnoseLiveTarget({
        target: attachSessionFileIfPresent(locator),
        trusted: input.trusted,
        requestedBy: input.requestedBy,
        skillConfigDir,
        mode: asEnterpriseDiagnoseMode(input.request.mode),
        observedSinceMs,
      });
      summaries.push(summary);
    } catch {
      // fail closed per locator; never throw into the RPC
    }
  }
  if (summaries.length === 0) {
    const empty = emptyPayload(input.request, planDiagnosisDaibaiDelivery(input.request.deliverTo));
    const failedPayload = sealReport(
      locators.length > 0
        ? {
            ...empty,
            reason: "failed",
            skipped: input.request.skipped + locators.length,
            requestedCount: Math.max(input.request.requestedCount, locators.length),
          }
        : empty,
      input.trusted.tenantId,
    );
    return {
      ...failedPayload,
      delivery: await resolveExecutionDelivery({
        ...input,
        locators,
        payload: failedPayload,
      }),
    };
  }
  const last = summaries[summaries.length - 1];
  const findings = summaries.flatMap((row) => row.findings).slice(0, 12);
  const failed = locators.length - summaries.length;
  const payload: DiagnoseExecutionPayload = {
    reportId: last.reportId,
    completion: mergeCompletion(summaries.map((row) => row.completion)),
    findingCount: summaries.reduce((sum, row) => sum + row.findingCount, 0),
    findings,
    windowId: input.request.windowId,
    mode: input.request.mode,
    scope: input.request.scope,
    scanned: summaries.length,
    skipped: input.request.skipped + failed,
    requestedCount: Math.max(input.request.requestedCount, locators.length),
    cadence: input.request.cadence,
    delivery: planDiagnosisDaibaiDelivery(input.request.deliverTo),
    reportIds: summaries.map((row) => row.reportId),
  };
  const sealed = await sealWithGrowth(payload, {
    locators,
    tenantId: input.trusted.tenantId,
    windowMs: input.request.windowMs,
    nowMs: now,
    skillConfigDir,
    confirmable: input.allowSelfEvolutionConfirm === true,
    growthReads: input.growthReads,
    structuralPreview: input.structuralPreview,
    registry: input.registry,
    loadGroupMembers: input.loadGroupMembers,
    sessionKeyExists: input.sessionKeyExists,
  });
  return {
    ...sealed,
    delivery: await resolveExecutionDelivery({
      ...input,
      locators,
      payload: sealed,
    }),
  };
}

async function resolveExecutionDelivery(input: {
  request: ParsedDiagnoseRequest;
  trusted: TrustedTenantContext;
  requestedBy?: { principalId?: string };
  allowConversationDelivery?: boolean;
  conversationSend?: DiagnoseConversationSend;
  resolveOwners?: DiagnoseConversationOwnerResolver;
  locators: ParsedDiagnoseRequest["locators"];
  payload: DiagnoseExecutionPayload;
}): Promise<DiagnosisDeliveryPlan> {
  const planned = planDiagnosisDaibaiDelivery(input.request.deliverTo);
  if (planned.routes.length === 0) {
    return planned;
  }
  if (input.allowConversationDelivery === false) {
    return { ...planned, reason: "tick_suppressed" };
  }
  if (!input.conversationSend) {
    return planned;
  }
  return deliverDiagnoseReportToConversation({
    request: { ...input.request, locators: input.locators },
    reportText: input.payload.reportText ?? "",
    send: input.conversationSend,
    tenantId: input.trusted.tenantId,
    requesterUserId: input.requestedBy?.principalId,
    resolveOwners: input.resolveOwners,
  });
}

async function sealWithGrowth(
  payload: DiagnoseExecutionPayload,
  input: {
    locators: ParsedDiagnoseRequest["locators"];
    tenantId: string | null;
    windowMs: number;
    nowMs: number;
    skillConfigDir: string;
    confirmable: boolean;
    growthReads?: GovernedGrowthRead[];
    structuralPreview?: {
      cfg: OpenBotConfig;
      sessionStorePath?: string;
    };
    /** Optional registry for group → member expand (A-class Rx prerequisite). */
    registry?: AgentRegistryStore;
    loadGroupMembers?: (groupId: string) => Promise<readonly ExpandMemberSource[] | null>;
    sessionKeyExists?: (agentId: string, sessionKey: string) => boolean;
  },
): Promise<DiagnoseExecutionPayload> {
  const growthReads = await attachServerStructuralSources({
    locators: input.locators,
    tenantId: input.tenantId,
    growthReads: input.growthReads,
    skillConfigDir: input.skillConfigDir,
    nowMs: input.nowMs,
    windowMs: input.windowMs,
    structuralPreview: input.structuralPreview,
  });
  const growths: DiagnoseGrowthAssessment[] = [];
  for (const locator of input.locators) {
    const read = growthReads.find((row) => row.agentId === locator.agentId);
    try {
      growths.push(
        await readDiagnoseGrowthAssessment({
          agentId: locator.agentId,
          sessionKey: locator.sessionKey,
          windowMs: input.windowMs,
          nowMs: input.nowMs,
          tenantId: read?.tenantId ?? input.tenantId,
          agentAssetId: read?.agentAssetId ?? null,
          targetOwnerId: read?.targetOwnerId ?? null,
          displayName: read?.displayName ?? null,
          hadTaskActivity: read?.hadTaskActivity,
          roleBaselineSkillIds: read?.roleBaselineSkillIds,
          workspaceDir: read?.workspaceDir ?? null,
          skillEvents: read?.skillEvents,
          scopedJobs: read?.scopedJobs,
          skillConfigDir: input.skillConfigDir,
        }),
      );
    } catch {
      // growth is advisory; runtime diagnose still returns
    }
  }
  const reportId = professionalReportId({
    tenantId: input.tenantId,
    sourceReportIds: payload.reportIds,
    windowId: payload.windowId,
    mode: payload.mode,
  });
  const prescriptions = growths.flatMap((assessment) =>
    buildDiagnoseEvolutionPrescriptions({
      assessment,
      professionalReportId: reportId,
      authorizationRef: growthReads.find((row) => row.agentId === assessment.agentId)
        ?.authorizationRef,
      confirmable: input.confirmable,
      existingJobs: growthReads.find((row) => row.agentId === assessment.agentId)?.scopedJobs,
      nowMs: input.nowMs,
      configDir: input.skillConfigDir,
    }),
  );
  const observationWindow = {
    startedAt: new Date(Math.max(0, input.nowMs - input.windowMs)).toISOString(),
    endedAt: new Date(input.nowMs).toISOString(),
  };
  const snapshots: Array<{ agentId: string; snapshot: GrowthAssessmentSnapshot }> = [];
  for (const assessment of growths) {
    const snapshot = persistGrowthAssessmentSnapshot({
      assessment,
      observationWindow,
      configDir: input.skillConfigDir,
      nowMs: input.nowMs,
    });
    if (snapshot) {
      snapshots.push({ agentId: assessment.agentId, snapshot });
    }
  }
  const structuralFacts = structuralFactsFromTrustedLiveSources({
    payload,
    growths,
    snapshots,
    growthReads,
    observedWindow: observationWindow,
  });
  const skillInstallationFacts = skillInstallationFactsFromTrustedLiveSources({
    payload,
    growths,
    snapshots,
    growthReads,
    observedWindow: observationWindow,
  });
  const reportRef = pickPersistedReportRef({ ...payload, growths, prescriptions });
  const growthArtifacts = buildDataPlaneArtifactsFromGrowth({
    growthReads,
    growths,
    tenantId: input.tenantId,
    reportRef: reportRef || undefined,
    nowMs: input.nowMs,
  });
  const sloArtifacts = buildEvidenceSloArtifacts({
    growths,
    growthReads,
    scanned: payload.scanned,
    tenantId: input.tenantId,
    reportRef: reportRef || undefined,
    nowMs: input.nowMs,
  });
  const mergedPlane = mergeDataPlaneArtifacts(growthArtifacts, sloArtifacts);
  const mergedFindings = [...payload.findings, ...mergedPlane.findings].slice(0, 24);
  const findingCount = mergedFindings.length;
  let completion = payload.completion;
  if (mergedPlane.hasLocatorFailed || sloArtifacts.unhealthy) {
    // Must not look healthy-ok when locator/SLO failed.
    if (completion !== "BLOCKED" && completion !== "TIMED_OUT") {
      completion = mergedPlane.hasLocatorFailed ? "BLOCKED" : "INCONCLUSIVE";
    }
  }

  const groupMemberExpand: GroupMemberExpandResult[] = [];
  const seenGroups = new Set<string>();
  for (const growth of growths) {
    const groupId = growth.groupId?.trim() ?? "";
    if (!groupId || seenGroups.has(groupId)) {
      continue;
    }
    seenGroups.add(groupId);
    if (input.loadGroupMembers && input.registry) {
      groupMemberExpand.push(
        await expandDiagnoseGroupMembers({
          tenantId: growth.tenantId ?? input.tenantId ?? "",
          groupId,
          loadMembers: input.loadGroupMembers,
          registry: input.registry,
          sessionKeyExists: input.sessionKeyExists,
        }),
      );
    } else {
      groupMemberExpand.push({
        groupId,
        members: [],
        emptyReason: "members_unreadable",
      });
    }
  }

  const sealed = sealReport(
    {
      ...payload,
      completion,
      findings: mergedFindings,
      findingCount,
      growths,
      prescriptions,
    },
    input.tenantId,
    structuralFacts,
    skillInstallationFacts,
    {
      dataPlaneCases: mergedPlane.cases,
      groupMemberExpand: groupMemberExpand.length > 0 ? groupMemberExpand : undefined,
    },
  );
  persistProducedEvolutionPreviews({
    report: sealed.professionalReport,
    tenantId: input.tenantId,
    configDir: input.skillConfigDir,
    nowMs: input.nowMs,
  });
  return sealed;
}

async function attachServerStructuralSources(input: {
  locators: ParsedDiagnoseRequest["locators"];
  tenantId: string | null;
  growthReads?: GovernedGrowthRead[];
  skillConfigDir: string;
  nowMs: number;
  windowMs: number;
  structuralPreview?: {
    cfg: OpenBotConfig;
    sessionStorePath?: string;
  };
}): Promise<GovernedGrowthRead[]> {
  const tenantId = input.tenantId?.trim() ?? "";
  const reads: GovernedGrowthRead[] = [];
  for (const locator of input.locators) {
    const existing = input.growthReads?.find((row) => row.agentId === locator.agentId);
    const stripped = stripCallerStructural(existing, locator.agentId, tenantId);
    if (!input.structuralPreview || !tenantId) {
      reads.push(stripped);
      continue;
    }
    // Tip-smoke / live: resolve per-agent sessions.json when caller omits path.
    // Tests may still override via structuralPreview.sessionStorePath.
    const sessionStorePath =
      input.structuralPreview.sessionStorePath?.trim() ||
      resolveSharedSessionStorePath(locator.agentId);
    const sources = await loadStructuralPreviewSources({
      cfg: input.structuralPreview.cfg,
      agentId: locator.agentId,
      tenantId,
      windowStartMs: Math.max(0, input.nowMs - input.windowMs),
      windowEndMs: input.nowMs,
      skillConfigDir: input.skillConfigDir,
      sessionStorePath,
    });
    reads.push(applyStructuralSources(stripped, sources));
  }
  return reads;
}

function stripCallerStructural(
  existing: GovernedGrowthRead | undefined,
  agentId: string,
  tenantId: string,
): GovernedGrowthRead {
  if (!existing) {
    return {
      agentId,
      tenantId,
      agentAssetId: "",
      targetOwnerId: "",
    };
  }
  return {
    ...existing,
    agentId,
    tenantId: existing.tenantId || tenantId,
    structuralObservation: undefined,
    structuralBaseline: undefined,
    structuralEvidenceRefs: undefined,
  };
}

function applyStructuralSources(
  read: GovernedGrowthRead,
  sources: StructuralPreviewSources,
): GovernedGrowthRead {
  const agentAssetId =
    read.agentAssetId.trim() || (sources.structuralObservation ? read.agentId : "");
  return {
    ...read,
    agentAssetId,
    hadTaskActivity: sources.hadTaskActivity,
    ...(sources.structuralObservation
      ? { structuralObservation: sources.structuralObservation }
      : {}),
    ...(sources.structuralBaseline ? { structuralBaseline: sources.structuralBaseline } : {}),
    ...(sources.evidenceRefs.length > 0 ? { structuralEvidenceRefs: sources.evidenceRefs } : {}),
  };
}

function structuralFactsFromTrustedLiveSources(input: {
  payload: DiagnoseExecutionPayload;
  growths: DiagnoseGrowthAssessment[];
  snapshots: Array<{ agentId: string; snapshot: GrowthAssessmentSnapshot }>;
  growthReads?: GovernedGrowthRead[];
  observedWindow: { startedAt: string; endedAt: string };
}): StructuralPreviewFact[] {
  const facts: StructuralPreviewFact[] = [];
  const reportRef = pickPersistedReportRef(input.payload);
  const findingRef = pickFindingRef(input.payload);
  for (const growth of input.growths) {
    const read = input.growthReads?.find((row) => row.agentId === growth.agentId);
    const snapshot = input.snapshots.find((row) => row.agentId === growth.agentId)?.snapshot;
    if (!read?.structuralObservation || !read.structuralBaseline || !snapshot) {
      continue;
    }
    const fact = buildStructuralPreviewFact({
      observation: read.structuralObservation,
      baseline: read.structuralBaseline,
      reportRef,
      findingRef: findingRef || read.structuralObservation.observationRef,
      evidenceRefs: [
        snapshot.snapshotId,
        ...(read.structuralEvidenceRefs ?? [read.structuralObservation.observationRef]),
      ],
      snapshotRef: snapshot.snapshotId,
      targetHint: growth.agentId,
      observedWindow: input.observedWindow,
    });
    if (fact) {
      facts.push(fact);
    }
  }
  return facts;
}

function skillInstallationFactsFromTrustedLiveSources(input: {
  payload: DiagnoseExecutionPayload;
  growths: DiagnoseGrowthAssessment[];
  snapshots: Array<{ agentId: string; snapshot: GrowthAssessmentSnapshot }>;
  growthReads?: GovernedGrowthRead[];
  observedWindow: { startedAt: string; endedAt: string };
}): SkillInstallationPreviewFact[] {
  const facts: SkillInstallationPreviewFact[] = [];
  const reportRef = pickPersistedReportRef(input.payload);
  const findingRef = pickFindingRef(input.payload);
  for (const growth of input.growths) {
    const read = input.growthReads?.find((row) => row.agentId === growth.agentId);
    const snapshot = input.snapshots.find((row) => row.agentId === growth.agentId)?.snapshot;
    if (!read?.skillInstallationObservation || !read.skillInstallationBaseline || !snapshot) {
      continue;
    }
    const fact = buildSkillInstallationPreviewFact({
      observation: read.skillInstallationObservation,
      baseline: read.skillInstallationBaseline,
      reportRef,
      findingRef,
      evidenceRefs: [snapshot.snapshotId, read.skillInstallationObservation.observationRef],
      snapshotRef: snapshot.snapshotId,
      targetHint: growth.agentId,
      observedWindow: input.observedWindow,
    });
    if (fact) {
      facts.push(fact);
    }
  }
  return facts;
}

function pickPersistedReportRef(payload: DiagnoseExecutionPayload): string {
  const ids = [payload.reportId, ...payload.reportIds].filter(
    (id): id is string => typeof id === "string" && id.trim() !== "",
  );
  return ids.find((id) => !id.startsWith("pdr-"))?.trim() ?? "";
}

function pickFindingRef(payload: DiagnoseExecutionPayload): string {
  return payload.findings.find((row) => row.findingId.trim() !== "")?.findingId.trim() ?? "";
}

function sealReport(
  payload: DiagnoseExecutionPayload,
  tenantId: string | null,
  structuralFacts: StructuralPreviewFact[] = [],
  skillInstallationFacts: SkillInstallationPreviewFact[] = [],
  dataPlane?: {
    dataPlaneCases?: DataPlaneCase[];
    groupMemberExpand?: GroupMemberExpandResult[];
  },
): DiagnoseExecutionPayload {
  const report = buildProfessionalDiagnosisReport({
    completion: payload.completion,
    findingCount: payload.findingCount,
    findings: payload.findings,
    windowId: payload.windowId,
    mode: payload.mode,
    scope: payload.scope,
    scanned: payload.scanned,
    skipped: payload.skipped,
    reportId: payload.reportId,
    reportIds: payload.reportIds,
    reason: payload.reason,
    growths: payload.growths,
    prescriptions: payload.prescriptions,
    structuralFacts,
    skillInstallationFacts,
    tenantId,
    dataPlaneCases: dataPlane?.dataPlaneCases,
    groupMemberExpand: dataPlane?.groupMemberExpand,
  });
  return {
    ...payload,
    professionalReport: report,
    reportText: formatProfessionalDiagnosisReport(report),
  };
}
