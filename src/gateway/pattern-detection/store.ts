import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { structureHashFromIo } from "./structure-hash.js";
import type { IngestPatternSampleInput, PatternCandidate, PatternSample } from "./types.js";

const STORE_DIR = path.join(CONFIG_DIR, "pattern-detection");
const SAMPLES_FILE = path.join(STORE_DIR, "samples.json");
const CANDIDATES_FILE = path.join(STORE_DIR, "candidates.json");

const DEFAULT_MIN_INDEPENDENT_TASKS = 3;
const DEFAULT_MIN_CONFIDENCE = 0.7;

type PatternStore = {
  samples: PatternSample[];
  candidates: PatternCandidate[];
};

function emptyStore(): PatternStore {
  return { samples: [], candidates: [] };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readStore(): PatternStore {
  return {
    samples: readJsonFile<PatternSample[]>(SAMPLES_FILE, []),
    candidates: readJsonFile<PatternCandidate[]>(CANDIDATES_FILE, []),
  };
}

function writeSamples(samples: PatternSample[]): void {
  writeJsonFile(SAMPLES_FILE, samples);
}

function writeCandidates(candidates: PatternCandidate[]): void {
  writeJsonFile(CANDIDATES_FILE, candidates);
}

function structureKey(
  sample: Pick<PatternSample, "inputStructureHash" | "outputStructureHash" | "toolTraceHash">,
): string {
  return [sample.inputStructureHash, sample.outputStructureHash, sample.toolTraceHash ?? ""].join(
    "|",
  );
}

function independenceKey(sample: PatternSample): string {
  // Prefer runId (each agent turn is an independent sample). Do NOT fold by sessionKey —
  // long-lived sessions would collapse many real tasks into one sample.
  // Explicit taskId only when it is not equal to sessionKey (true task id).
  const taskId = sample.taskId?.trim() || "";
  const sessionKey = sample.sessionKey?.trim() || "";
  if (taskId && taskId !== sessionKey) {
    return `task:${taskId}`;
  }
  if (sample.runId?.trim()) {
    return `run:${sample.runId.trim()}`;
  }
  return `sample:${sample.sampleId}`;
}

/**
 * Ingest one execution sample. sampleCount on candidates is derived only from
 * distinct independence keys (taskId/runId), never from frontend-hardcoded 3.
 */
export function ingestPatternSample(input: IngestPatternSampleInput): {
  sample: PatternSample;
  candidate: PatternCandidate | null;
} {
  const agentId = input.agentId.trim();
  if (!agentId) {
    throw new Error("agentId is required");
  }
  const inputStructureHash = input.inputStructureHash.trim();
  const outputStructureHash = input.outputStructureHash.trim();
  if (!inputStructureHash || !outputStructureHash) {
    throw new Error("inputStructureHash and outputStructureHash are required");
  }

  const sample: PatternSample = {
    sampleId: `ps_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    agentId,
    tenantId: input.tenantId ?? null,
    runId: input.runId?.trim() || null,
    taskId: input.taskId?.trim() || null,
    sessionKey: input.sessionKey?.trim() || null,
    recordedAt: input.recordedAt ?? Date.now(),
    inputStructureHash,
    outputStructureHash,
    toolTraceHash: input.toolTraceHash?.trim() || null,
    toolsUsed: Array.isArray(input.toolsUsed)
      ? [
          ...new Set(
            input.toolsUsed.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean),
          ),
        ].slice(0, 32)
      : null,
    success: input.success ?? null,
    humanEdited: input.humanEdited ?? null,
  };

  const store = readStore();
  // Dedup exact same run+structure for same agent.
  const duplicate = store.samples.find(
    (existing) =>
      existing.agentId === sample.agentId &&
      existing.tenantId === sample.tenantId &&
      existing.runId &&
      existing.runId === sample.runId &&
      structureKey(existing) === structureKey(sample),
  );
  if (!duplicate) {
    store.samples.push(sample);
    writeSamples(store.samples);
  }

  const candidate = recomputeCandidateForSample({
    sample: duplicate ?? sample,
    allSamples: store.samples,
    existingCandidates: store.candidates,
    nameHint: input.suggestedNameHint,
    summaryHint: input.suggestedSummaryHint,
  });
  if (candidate) {
    const others = store.candidates.filter((entry) => entry.candidateId !== candidate.candidateId);
    writeCandidates([...others, candidate]);
  }
  return { sample: duplicate ?? sample, candidate };
}

export function listPatternSamples(): PatternSample[] {
  return readStore().samples;
}

/** Fill toolsUsed on samples that share runId and recompute their candidate contract. */
export function applyToolsUsedByRunId(
  runId: string,
  toolsUsed: readonly string[],
): PatternSample[] {
  const names = [...new Set(toolsUsed.map((name) => name.trim()).filter(Boolean))].slice(0, 32);
  const id = runId.trim();
  if (!id || names.length === 0) {
    return [];
  }
  const store = readStore();
  const patched: PatternSample[] = [];
  store.samples = store.samples.map((sample) => {
    if (sample.runId !== id) {
      return sample;
    }
    if (Array.isArray(sample.toolsUsed) && sample.toolsUsed.length > 0) {
      return sample;
    }
    const next = { ...sample, toolsUsed: names };
    patched.push(next);
    return next;
  });
  if (patched.length === 0) {
    return [];
  }
  writeSamples(store.samples);
  let candidates = store.candidates;
  for (const sample of patched) {
    const candidate = recomputeCandidateForSample({
      sample,
      allSamples: store.samples,
      existingCandidates: candidates,
    });
    if (candidate) {
      candidates = [
        ...candidates.filter((entry) => entry.candidateId !== candidate.candidateId),
        candidate,
      ];
    }
  }
  writeCandidates(candidates);
  return patched;
}

export function listPatternCandidates(params?: {
  agentId?: string;
  tenantId?: string | null;
  status?: PatternCandidate["status"];
}): PatternCandidate[] {
  const store = readStore();
  return store.candidates.filter((candidate) => {
    if (params?.agentId && candidate.agentId !== params.agentId) {
      return false;
    }
    if (params?.tenantId !== undefined && candidate.tenantId !== params.tenantId) {
      return false;
    }
    if (params?.status && candidate.status !== params.status) {
      return false;
    }
    return true;
  });
}

export function getPatternCandidate(candidateId: string): PatternCandidate | null {
  return readStore().candidates.find((entry) => entry.candidateId === candidateId) ?? null;
}

export type ApprovePatternCandidateOptions = {
  /** Operator / principal who approved (required for audit trail in production RPCs). */
  approvedBy?: string | null;
  /**
   * When true, marks autoInstallIntent so skill-auto may enroll an install job.
   * Does not install by itself; never bypasses dual skill-auto + governance=auto gates.
   */
  autoInstallIntent?: boolean;
  /** Optional policy snapshot; defaults to current env thresholds. */
  approvalPolicySnapshot?: PatternCandidate["approvalPolicySnapshot"];
};

/** Current skill-auto quality policy version (bump when thresholds semantics change). */
export const PATTERN_APPROVAL_POLICY_VERSION = "skill-auto-v1";

export function captureDefaultApprovalPolicySnapshot(): NonNullable<
  PatternCandidate["approvalPolicySnapshot"]
> {
  const minInd = Number(process.env.OPENBOT_SKILL_AUTO_MIN_INDEPENDENT);
  const minConf = Number(process.env.OPENBOT_SKILL_AUTO_MIN_CONFIDENCE);
  const minSucc = Number(process.env.OPENBOT_SKILL_AUTO_MIN_SUCCESS_RATE);
  return {
    policyVersion: PATTERN_APPROVAL_POLICY_VERSION,
    minIndependent: Number.isFinite(minInd) && minInd >= 1 ? Math.floor(minInd) : 3,
    minConfidence: Number.isFinite(minConf) && minConf > 0 && minConf <= 1 ? minConf : 0.7,
    minSuccessRate: Number.isFinite(minSucc) && minSucc > 0 && minSucc <= 1 ? minSucc : 0.7,
    capturedAt: Date.now(),
  };
}

export function approvePatternCandidate(
  candidateId: string,
  options?: ApprovePatternCandidateOptions,
): PatternCandidate {
  const store = readStore();
  const index = store.candidates.findIndex((entry) => entry.candidateId === candidateId);
  if (index < 0) {
    throw new Error(`pattern candidate ${candidateId} not found`);
  }
  const current = store.candidates[index];
  if (current.status === "published") {
    throw new Error(`pattern candidate ${candidateId} already published`);
  }
  if (current.status === "rejected") {
    throw new Error(`pattern candidate ${candidateId} is rejected`);
  }
  const now = Date.now();
  const next: PatternCandidate = {
    ...current,
    status: "approved",
    approvedBy: options?.approvedBy?.trim() || current.approvedBy || null,
    approvedAt: now,
    approvalPolicySnapshot:
      options?.approvalPolicySnapshot ??
      current.approvalPolicySnapshot ??
      captureDefaultApprovalPolicySnapshot(),
    autoInstallIntent:
      options?.autoInstallIntent === true ? true : (current.autoInstallIntent ?? false),
    updatedAt: now,
  };
  store.candidates[index] = next;
  writeCandidates(store.candidates);
  return next;
}

export function rejectPatternCandidate(candidateId: string): PatternCandidate {
  return updateCandidateStatus(candidateId, "rejected");
}

/** Clear auto-install intent (does not cancel an in-flight job — use cancelSkillAutoInstallJob). */
export function clearPatternAutoInstallIntent(candidateId: string): PatternCandidate {
  return setPatternAutoInstallIntent(candidateId, false);
}

/** Set/clear auto-install intent without changing lifecycle status. */
export function setPatternAutoInstallIntent(
  candidateId: string,
  intent: boolean,
): PatternCandidate {
  const store = readStore();
  const index = store.candidates.findIndex((entry) => entry.candidateId === candidateId);
  if (index < 0) {
    throw new Error(`pattern candidate ${candidateId} not found`);
  }
  const current = store.candidates[index];
  if (current.status === "rejected") {
    throw new Error(`pattern candidate ${candidateId} is rejected`);
  }
  const next: PatternCandidate = {
    ...current,
    autoInstallIntent: intent,
    updatedAt: Date.now(),
  };
  store.candidates[index] = next;
  writeCandidates(store.candidates);
  return next;
}

/** Mark candidate published after a draft skill was materialised (lineage complete). */
export function updateCandidatePublished(
  candidateId: string,
  publishedSkillId: string,
): PatternCandidate {
  const store = readStore();
  const index = store.candidates.findIndex((entry) => entry.candidateId === candidateId);
  if (index < 0) {
    throw new Error(`pattern candidate ${candidateId} not found`);
  }
  const current = store.candidates[index];
  if (current.status === "rejected") {
    throw new Error(`pattern candidate ${candidateId} is rejected`);
  }
  const next: PatternCandidate = {
    ...current,
    status: "published",
    publishedSkillId,
    suggestedSummary: current.suggestedSummary.includes(publishedSkillId)
      ? current.suggestedSummary
      : `${current.suggestedSummary} (skill:${publishedSkillId})`,
    updatedAt: Date.now(),
  };
  store.candidates[index] = next;
  writeCandidates(store.candidates);
  return next;
}

function updateCandidateStatus(
  candidateId: string,
  status: PatternCandidate["status"],
): PatternCandidate {
  const store = readStore();
  const index = store.candidates.findIndex((entry) => entry.candidateId === candidateId);
  if (index < 0) {
    throw new Error(`pattern candidate ${candidateId} not found`);
  }
  const current = store.candidates[index];
  if (current.status === "published" && status !== "published") {
    throw new Error(`pattern candidate ${candidateId} already published`);
  }
  const next: PatternCandidate = {
    ...current,
    status,
    // Reject clears install intent
    ...(status === "rejected" ? { autoInstallIntent: false } : {}),
    updatedAt: Date.now(),
  };
  store.candidates[index] = next;
  writeCandidates(store.candidates);
  return next;
}

function recomputeCandidateForSample(params: {
  sample: PatternSample;
  allSamples: PatternSample[];
  existingCandidates: PatternCandidate[];
  nameHint?: string;
  summaryHint?: string;
}): PatternCandidate | null {
  const key = structureKey(params.sample);
  const cluster = params.allSamples.filter(
    (entry) =>
      entry.agentId === params.sample.agentId &&
      entry.tenantId === params.sample.tenantId &&
      structureKey(entry) === key,
  );
  const independence = new Map<string, PatternSample>();
  for (const entry of cluster) {
    independence.set(independenceKey(entry), entry);
  }
  const independentSamples = [...independence.values()];
  const independentTaskCount = independentSamples.length;
  if (independentTaskCount < DEFAULT_MIN_INDEPENDENT_TASKS) {
    return null;
  }

  const successKnown = independentSamples.filter((entry) => entry.success !== null);
  const successRate =
    successKnown.length > 0
      ? successKnown.filter((entry) => entry.success).length / successKnown.length
      : null;
  const humanEditedKnown = independentSamples.filter((entry) => entry.humanEdited !== null);
  const editRate =
    humanEditedKnown.length > 0
      ? humanEditedKnown.filter((entry) => entry.humanEdited).length / humanEditedKnown.length
      : null;

  // Confidence: base from sample depth + success boost - heavy edit penalty.
  let confidence = Math.min(0.95, 0.55 + independentTaskCount * 0.08);
  if (successRate != null) {
    confidence = confidence * (0.7 + 0.3 * successRate);
  }
  if (editRate != null && editRate > 0.5) {
    confidence *= 0.85;
  }
  confidence = Math.max(0, Math.min(1, confidence));
  if (confidence < DEFAULT_MIN_CONFIDENCE) {
    return null;
  }

  const existing = params.existingCandidates.find(
    (entry) =>
      entry.agentId === params.sample.agentId &&
      entry.tenantId === params.sample.tenantId &&
      entry.lineage.structureKey === key &&
      entry.status === "candidate",
  );
  const now = Date.now();
  const runIds = independentSamples
    .map((entry) => entry.runId)
    .filter((value): value is string => Boolean(value));
  const firstSeenAt = Math.min(...independentSamples.map((entry) => entry.recordedAt));
  const lastSeenAt = Math.max(...independentSamples.map((entry) => entry.recordedAt));
  // Prefer concrete tool names from samples; fall back to toolTraceHash only if names absent.
  const namedTools = [
    ...new Set(
      independentSamples.flatMap((entry) =>
        Array.isArray(entry.toolsUsed) ? entry.toolsUsed.filter(Boolean) : [],
      ),
    ),
  ].slice(0, 16);
  const toolsRequired =
    namedTools.length > 0
      ? namedTools
      : [
          ...new Set(
            independentSamples
              .map((entry) => entry.toolTraceHash)
              .filter((value): value is string => Boolean(value)),
          ),
        ].slice(0, 8);

  const contract = {
    inputDescription: "与历史稳定任务相似的业务输入（由多样本结构指纹聚类）",
    outputDescription: "与历史稳定输出结构一致的业务产物",
    toolsRequired,
    dependencies: [] as string[],
    riskLevel: (editRate != null && editRate > 0.4 ? "high" : "medium") as
      | "low"
      | "medium"
      | "high",
    requiresHumanApproval: true as const,
    quality: {
      successRate,
      humanEditRate: editRate,
      independentTaskCount,
      timeSpanMs: Math.max(0, lastSeenAt - firstSeenAt),
    },
  };

  const base: PatternCandidate = existing ?? {
    candidateId: `pc_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    agentId: params.sample.agentId,
    tenantId: params.sample.tenantId,
    status: "candidate",
    sampleCount: 0,
    independentTaskCount: 0,
    independentRunIds: [],
    firstSeenAt,
    lastSeenAt: now,
    overallConfidence: 0,
    suggestedName: params.nameHint?.trim() || "稳定工作模式",
    suggestedSummary: params.summaryHint?.trim() || "跨多次独立任务观察到的可复用执行模式",
    sampleIds: [],
    lineage: {
      evidenceKind: "server-pattern-samples",
      structureKey: key,
    },
    contract,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...base,
    sampleCount: independentTaskCount,
    independentTaskCount,
    independentRunIds: [...new Set(runIds)],
    firstSeenAt,
    lastSeenAt,
    overallConfidence: confidence,
    suggestedName: params.nameHint?.trim() || base.suggestedName,
    suggestedSummary: params.summaryHint?.trim() || base.suggestedSummary,
    sampleIds: independentSamples.map((entry) => entry.sampleId),
    contract,
    updatedAt: now,
  };
}

export function resetPatternDetectionStoreForTests(): void {
  try {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export { emptyStore as emptyPatternStoreForTests };

/**
 * W2: confirm unknown (success=null) pattern samples once TaskOutcome tip is closed + eligible.
 * Never invents success at attempt time; only patches null → judged. Already-judged samples stay.
 * Also rewrites outputStructureHash so confirmed samples leave the unknown cluster.
 */
export function confirmPatternOutcomeByRunId(
  runId: string,
  success: boolean,
  opts?: { taskId?: string | null },
): PatternSample[] {
  const id = runId.trim();
  if (!id) {
    return [];
  }
  const store = readStore();
  const nextHash = structureHashFromIo(success ? "ok" : "error", "output");
  const patched: PatternSample[] = [];
  store.samples = store.samples.map((sample) => {
    if (sample.runId !== id) {
      return sample;
    }
    if (sample.success !== null) {
      return sample;
    }
    const next: PatternSample = {
      ...sample,
      success,
      outputStructureHash: nextHash,
      ...(opts?.taskId?.trim() && !sample.taskId ? { taskId: opts.taskId.trim() } : {}),
    };
    patched.push(next);
    return next;
  });
  if (patched.length === 0) {
    return [];
  }
  writeSamples(store.samples);
  let candidates = store.candidates;
  for (const sample of patched) {
    const candidate = recomputeCandidateForSample({
      sample,
      allSamples: store.samples,
      existingCandidates: candidates,
    });
    if (candidate) {
      candidates = [
        ...candidates.filter((entry) => entry.candidateId !== candidate.candidateId),
        candidate,
      ];
    }
  }
  writeCandidates(candidates);
  return patched;
}
