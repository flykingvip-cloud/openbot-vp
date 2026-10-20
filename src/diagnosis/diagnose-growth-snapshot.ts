/**
 * Immutable hashed growth-assessment snapshot.
 * This is an Evidence projection, not a new business fact source.
 * Track B may read/validate it. Diagnosis never copies chat, file text,
 * prompts, or tool output into the snapshot.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";

export const GROWTH_ASSESSMENT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const GROWTH_ASSESSMENT_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const GROWTH_ASSESSMENT_SNAPSHOT_KIND = "growth_assessment_evidence_projection" as const;

export type GrowthSnapshotWindow = {
  startedAt: string;
  endedAt: string;
};

export type GrowthSnapshotMetricSummary = {
  identityMissingCount: number;
  userMissingCount: number;
  memoryFileCount: number;
  reportFileCount: number;
  freshArtifactCount: number;
  installedSkillCount: number;
  capableCount: number;
  unstableCount: number;
  unusedCount: number;
  baselineGapCount: number;
  hadTaskActivity: boolean;
  memoryJudgedMissing: boolean;
  sessionRoster: DiagnoseGrowthAssessment["sessionRoster"];
  activitySources: DiagnoseGrowthAssessment["activitySources"];
};

export type GrowthAssessmentSnapshot = {
  schemaVersion: typeof GROWTH_ASSESSMENT_SNAPSHOT_SCHEMA_VERSION;
  kind: typeof GROWTH_ASSESSMENT_SNAPSHOT_KIND;
  snapshotId: string;
  tenantId: string;
  agentAssetId: string;
  agentId: string;
  observationWindow: GrowthSnapshotWindow;
  authoritySourceRefs: string[];
  baselineRefs: string[];
  metricSummary: GrowthSnapshotMetricSummary;
  payloadHash: string;
  createdAt: string;
  expiresAt: string;
};

export type GrowthSnapshotValidation =
  | { ok: true; snapshot: GrowthAssessmentSnapshot }
  | { ok: false; reason: string };

export function projectGrowthMetricSummary(
  assessment: DiagnoseGrowthAssessment,
): GrowthSnapshotMetricSummary {
  return {
    identityMissingCount: (assessment.identityMissingFields ?? []).length,
    userMissingCount: (assessment.userMissingFields ?? []).length,
    memoryFileCount: assessment.memoryFileCount ?? 0,
    reportFileCount: assessment.reportFileCount ?? 0,
    freshArtifactCount: assessment.freshArtifactCount ?? 0,
    installedSkillCount: (assessment.installedSkillIds ?? []).length,
    capableCount: (assessment.capable ?? []).length,
    unstableCount: (assessment.unstable ?? []).length,
    unusedCount: (assessment.unused ?? []).length,
    baselineGapCount: (assessment.baselineGapCandidates ?? []).length,
    hadTaskActivity: assessment.hadTaskActivity,
    memoryJudgedMissing: assessment.memoryJudgedMissing,
    sessionRoster: assessment.sessionRoster,
    activitySources: [...(assessment.activitySources ?? [])],
  };
}

export function validateGrowthAssessmentSnapshot(input: unknown): GrowthSnapshotValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "snapshot_required" };
  }
  const raw = input as Record<string, unknown>;
  if (containsForbiddenPayload(raw)) {
    return { ok: false, reason: "payload_forbidden" };
  }
  if (raw.schemaVersion !== GROWTH_ASSESSMENT_SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version" };
  }
  if (raw.kind !== GROWTH_ASSESSMENT_SNAPSHOT_KIND) {
    return { ok: false, reason: "snapshot_kind" };
  }
  const tenantId = readRequiredString(raw.tenantId);
  const agentAssetId = readRequiredString(raw.agentAssetId);
  const agentId = readRequiredString(raw.agentId);
  const snapshotId = readRequiredString(raw.snapshotId);
  const payloadHash = readRequiredString(raw.payloadHash);
  const createdAt = readRequiredString(raw.createdAt);
  const expiresAt = readRequiredString(raw.expiresAt);
  if (!tenantId || !agentAssetId || !agentId || !snapshotId || !payloadHash) {
    return { ok: false, reason: "required_field" };
  }
  if (!/^[a-f0-9]{64}$/.test(snapshotId) || !/^[a-f0-9]{64}$/.test(payloadHash)) {
    return { ok: false, reason: "payload_hash" };
  }
  const timeReason = validateSnapshotTimes(createdAt, expiresAt);
  if (timeReason) {
    return { ok: false, reason: timeReason };
  }
  const observationWindow = readWindow(raw.observationWindow);
  if (!observationWindow) {
    return { ok: false, reason: "observation_window" };
  }
  const metricSummary = readMetricSummary(raw.metricSummary);
  if (!metricSummary) {
    return { ok: false, reason: "metric_summary" };
  }
  const authoritySourceRefs = readStringList(raw.authoritySourceRefs);
  const baselineRefs = readStringList(raw.baselineRefs);
  const sealed = sealSnapshot({
    tenantId,
    agentAssetId,
    agentId,
    observationWindow,
    authoritySourceRefs,
    baselineRefs,
    metricSummary,
    createdAt,
    expiresAt,
  });
  if (sealed.payloadHash !== payloadHash || sealed.snapshotId !== snapshotId) {
    return { ok: false, reason: "payload_hash" };
  }
  return { ok: true, snapshot: sealed };
}

export function persistGrowthAssessmentSnapshot(input: {
  assessment: DiagnoseGrowthAssessment;
  observationWindow: GrowthSnapshotWindow;
  configDir: string;
  nowMs?: number;
  authoritySourceRefs?: string[];
  baselineRefs?: string[];
}): GrowthAssessmentSnapshot | null {
  const tenantId = input.assessment.tenantId?.trim() ?? "";
  const agentAssetId = input.assessment.agentAssetId?.trim() ?? "";
  const agentId = input.assessment.agentId.trim();
  if (!tenantId || !agentAssetId || !agentId) {
    return null;
  }
  const nowMs = input.nowMs ?? Date.now();
  const snapshot = sealSnapshot({
    tenantId,
    agentAssetId,
    agentId,
    observationWindow: input.observationWindow,
    authoritySourceRefs: input.authoritySourceRefs ?? defaultAuthorityRefs(input.assessment),
    baselineRefs: input.baselineRefs ?? [],
    metricSummary: projectGrowthMetricSummary(input.assessment),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + GROWTH_ASSESSMENT_SNAPSHOT_TTL_MS).toISOString(),
  });
  return writeSnapshotFile(input.configDir, snapshot);
}

export function readGrowthAssessmentSnapshot(input: {
  tenantId: string;
  snapshotId: string;
  configDir: string;
  nowMs?: number;
}): GrowthSnapshotValidation {
  const tenantId = input.tenantId.trim();
  const snapshotId = input.snapshotId.trim();
  if (!tenantId) {
    return { ok: false, reason: "tenant_required" };
  }
  if (!/^[a-f0-9]{64}$/.test(snapshotId)) {
    return { ok: false, reason: "path_rejected" };
  }
  const file = snapshotFilePath(input.configDir, tenantId, snapshotId);
  if (!file) {
    return { ok: false, reason: "path_rejected" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { ok: false, reason: "snapshot_missing" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ok: false, reason: "symlink_rejected" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return { ok: false, reason: "snapshot_corrupt" };
  }
  const validated = validateGrowthAssessmentSnapshot(parsed);
  if (!validated.ok) {
    return validated;
  }
  if (validated.snapshot.tenantId !== tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(validated.snapshot.expiresAt) <= nowMs) {
    return { ok: false, reason: "expired" };
  }
  return validated;
}

function sealSnapshot(input: {
  tenantId: string;
  agentAssetId: string;
  agentId: string;
  observationWindow: GrowthSnapshotWindow;
  authoritySourceRefs: string[];
  baselineRefs: string[];
  metricSummary: GrowthSnapshotMetricSummary;
  createdAt: string;
  expiresAt: string;
}): GrowthAssessmentSnapshot {
  const payloadHash = hashCanonical({
    schemaVersion: GROWTH_ASSESSMENT_SNAPSHOT_SCHEMA_VERSION,
    kind: GROWTH_ASSESSMENT_SNAPSHOT_KIND,
    tenantId: input.tenantId,
    agentAssetId: input.agentAssetId,
    agentId: input.agentId,
    observationWindow: input.observationWindow,
    authoritySourceRefs: uniqueRefs(input.authoritySourceRefs),
    baselineRefs: uniqueRefs(input.baselineRefs),
    metricSummary: input.metricSummary,
  });
  return {
    schemaVersion: GROWTH_ASSESSMENT_SNAPSHOT_SCHEMA_VERSION,
    kind: GROWTH_ASSESSMENT_SNAPSHOT_KIND,
    snapshotId: payloadHash,
    tenantId: input.tenantId,
    agentAssetId: input.agentAssetId,
    agentId: input.agentId,
    observationWindow: input.observationWindow,
    authoritySourceRefs: uniqueRefs(input.authoritySourceRefs),
    baselineRefs: uniqueRefs(input.baselineRefs),
    metricSummary: input.metricSummary,
    payloadHash,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

function writeSnapshotFile(
  configDir: string,
  snapshot: GrowthAssessmentSnapshot,
): GrowthAssessmentSnapshot {
  const file = snapshotFilePath(configDir, snapshot.tenantId, snapshot.snapshotId);
  if (!file) {
    throw new Error("snapshot path rejected");
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  rejectSymlink(dir, "directory");
  try {
    const existingStat = fs.lstatSync(file);
    if (existingStat.isSymbolicLink()) {
      throw new Error("symlink_rejected");
    }
    const existing = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const validated = validateGrowthAssessmentSnapshot(existing);
    if (validated.ok && validated.snapshot.payloadHash === snapshot.payloadHash) {
      return validated.snapshot;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "symlink_rejected") {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // fall through to replace a corrupt peer with a sealed write
    }
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  rejectSymlink(tmp, "file");
  fs.renameSync(tmp, file);
  return snapshot;
}

function snapshotFilePath(configDir: string, tenantId: string, snapshotId: string): string | null {
  if (snapshotId.includes("..") || snapshotId.includes("/") || snapshotId.includes("\\")) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(snapshotId)) {
    return null;
  }
  const root = path.resolve(configDir, "diagnosis-growth-snapshots");
  const tenantDir = path.resolve(root, tenantDigest(tenantId));
  const file = path.resolve(tenantDir, `${snapshotId}.json`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return file;
}

function tenantDigest(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
}

function defaultAuthorityRefs(assessment: DiagnoseGrowthAssessment): string[] {
  return uniqueRefs([
    assessment.agentAssetId ? `agent-asset:${assessment.agentAssetId}` : "",
    assessment.agentId ? `agent:${assessment.agentId}` : "",
  ]);
}

function containsForbiddenPayload(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw);
  if (keys.some((key) => /chat|prompt|toolOutput|fileText|wakeText/i.test(key))) {
    return true;
  }
  const text = JSON.stringify(raw);
  return (
    text.includes("chat body") ||
    text.includes('"prompt"') ||
    text.includes("toolOutput") ||
    text.includes("fileText")
  );
}

function rejectSymlink(target: string, kind: "file" | "directory"): void {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error("symlink_rejected");
  }
  if (kind === "directory" && !stat.isDirectory()) {
    throw new Error("path_rejected");
  }
  if (kind === "file" && !stat.isFile()) {
    throw new Error("path_rejected");
  }
}

function validateSnapshotTimes(createdAt: string, expiresAt: string): string | null {
  const createdMs = readIsoInstant(createdAt);
  const expiresMs = readIsoInstant(expiresAt);
  if (createdMs === null || expiresMs === null) {
    return "snapshot_time";
  }
  if (createdMs >= expiresMs) {
    return "snapshot_time";
  }
  if (expiresMs - createdMs > GROWTH_ASSESSMENT_SNAPSHOT_TTL_MS) {
    return "ttl_exceeded";
  }
  return null;
}

function readIsoInstant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  if (new Date(ms).toISOString() !== value) {
    return null;
  }
  return ms;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();
}

function readRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueRefs(value.filter((row): row is string => typeof row === "string"))
    : [];
}

function readWindow(value: unknown): GrowthSnapshotWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const startedAt = readRequiredString((value as { startedAt?: unknown }).startedAt);
  const endedAt = readRequiredString((value as { endedAt?: unknown }).endedAt);
  if (!startedAt || !endedAt || Date.parse(startedAt) >= Date.parse(endedAt)) {
    return null;
  }
  return { startedAt, endedAt };
}

function readMetricSummary(value: unknown): GrowthSnapshotMetricSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const roster = raw.sessionRoster;
  if (!roster || typeof roster !== "object" || Array.isArray(roster)) {
    return null;
  }
  return {
    identityMissingCount: asCount(raw.identityMissingCount),
    userMissingCount: asCount(raw.userMissingCount),
    memoryFileCount: asCount(raw.memoryFileCount),
    reportFileCount: asCount(raw.reportFileCount),
    freshArtifactCount: asCount(raw.freshArtifactCount),
    installedSkillCount: asCount(raw.installedSkillCount),
    capableCount: asCount(raw.capableCount),
    unstableCount: asCount(raw.unstableCount),
    unusedCount: asCount(raw.unusedCount),
    baselineGapCount: asCount(raw.baselineGapCount),
    hadTaskActivity: Boolean(raw.hadTaskActivity),
    memoryJudgedMissing: Boolean(raw.memoryJudgedMissing),
    sessionRoster: {
      main: asCount((roster as { main?: unknown }).main),
      cron: asCount((roster as { cron?: unknown }).cron),
      other: asCount((roster as { other?: unknown }).other),
      freshCron: asCount((roster as { freshCron?: unknown }).freshCron),
      freshMain: asCount((roster as { freshMain?: unknown }).freshMain),
    },
    activitySources: readStringList(
      raw.activitySources,
    ) as GrowthSnapshotMetricSummary["activitySources"],
  };
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
