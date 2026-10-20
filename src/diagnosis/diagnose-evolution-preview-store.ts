/**
 * Persist sealed B-class preview DTOs for later confirm-submit.
 * This is not a Proposal / Candidate / Ledger write. Diagnose never submits.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DiagnoseEvolutionProducerOutput } from "./diagnose-evolution-producer.js";
import {
  validateSkillInstallationCandidate,
  type SkillInstallationCandidate,
} from "./skill-installation-candidate.js";
import {
  validateStructuralEvolutionCandidate,
  type StructuralEvolutionCandidate,
} from "./structural-evolution-candidate.js";

export const DIAGNOSIS_EVOLUTION_PREVIEW_KIND = "diagnosis_evolution_preview" as const;
export const DIAGNOSIS_EVOLUTION_PREVIEW_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_EVOLUTION_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DiagnosisEvolutionPreviewCandidate =
  | StructuralEvolutionCandidate
  | SkillInstallationCandidate;

export type DiagnosisEvolutionPreviewRecord = {
  schemaVersion: typeof DIAGNOSIS_EVOLUTION_PREVIEW_SCHEMA_VERSION;
  kind: typeof DIAGNOSIS_EVOLUTION_PREVIEW_KIND;
  tenantId: string;
  candidateVersion: string;
  candidate: DiagnosisEvolutionPreviewCandidate;
  createdAt: string;
  expiresAt: string;
};

export type DiagnosisEvolutionPreviewRead =
  | { ok: true; record: DiagnosisEvolutionPreviewRecord }
  | { ok: false; reason: string };

export function persistProducedEvolutionPreviews(input: {
  report:
    | {
        producer: Pick<
          DiagnoseEvolutionProducerOutput,
          "structuralCandidates" | "skillInstallationCandidates"
        >;
      }
    | undefined;
  tenantId: string | null | undefined;
  configDir: string;
  nowMs?: number;
}): DiagnosisEvolutionPreviewRecord[] {
  const tenantId = input.tenantId?.trim() ?? "";
  if (!tenantId || !input.report) {
    return [];
  }
  const candidates = [
    ...(input.report.producer.structuralCandidates ?? []),
    ...(input.report.producer.skillInstallationCandidates ?? []),
  ];
  const nowMs = input.nowMs ?? Date.now();
  const out: DiagnosisEvolutionPreviewRecord[] = [];
  for (const candidate of candidates) {
    const sealed = sealPreviewRecord({
      tenantId,
      candidate,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + DIAGNOSIS_EVOLUTION_PREVIEW_TTL_MS).toISOString(),
    });
    if (sealed) {
      out.push(writePreviewFile(input.configDir, sealed));
    }
  }
  return out;
}

export function readDiagnosisEvolutionPreview(input: {
  tenantId: string;
  candidateVersion: string;
  configDir: string;
  nowMs?: number;
}): DiagnosisEvolutionPreviewRead {
  const tenantId = input.tenantId.trim();
  const candidateVersion = input.candidateVersion.trim();
  if (!tenantId) {
    return { ok: false, reason: "tenant_required" };
  }
  const file = previewFilePath(input.configDir, tenantId, candidateVersion);
  if (!file) {
    return { ok: false, reason: "path_rejected" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { ok: false, reason: "preview_missing" };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ok: false, reason: "symlink_rejected" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return { ok: false, reason: "preview_corrupt" };
  }
  const validated = validatePreviewRecord(parsed);
  if (!validated.ok) {
    return validated;
  }
  if (validated.record.tenantId !== tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(validated.record.expiresAt) <= nowMs) {
    return { ok: false, reason: "expired" };
  }
  return validated;
}

function sealPreviewRecord(input: {
  tenantId: string;
  candidate: DiagnosisEvolutionPreviewCandidate;
  createdAt: string;
  expiresAt: string;
}): DiagnosisEvolutionPreviewRecord | null {
  const candidate = readCandidate(input.candidate);
  if (!candidate) {
    return null;
  }
  if (!isIsoInstant(input.createdAt) || !isIsoInstant(input.expiresAt)) {
    return null;
  }
  if (Date.parse(input.createdAt) >= Date.parse(input.expiresAt)) {
    return null;
  }
  return {
    schemaVersion: DIAGNOSIS_EVOLUTION_PREVIEW_SCHEMA_VERSION,
    kind: DIAGNOSIS_EVOLUTION_PREVIEW_KIND,
    tenantId: input.tenantId,
    candidateVersion: candidate.candidateVersion,
    candidate,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

function validatePreviewRecord(input: unknown): DiagnosisEvolutionPreviewRead {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "preview_required" };
  }
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion !== DIAGNOSIS_EVOLUTION_PREVIEW_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version" };
  }
  if (raw.kind !== DIAGNOSIS_EVOLUTION_PREVIEW_KIND) {
    return { ok: false, reason: "kind" };
  }
  const tenantId = typeof raw.tenantId === "string" ? raw.tenantId.trim() : "";
  const candidateVersion =
    typeof raw.candidateVersion === "string" ? raw.candidateVersion.trim() : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt.trim() : "";
  const expiresAt = typeof raw.expiresAt === "string" ? raw.expiresAt.trim() : "";
  if (!tenantId || !candidateVersion || !isIsoInstant(createdAt) || !isIsoInstant(expiresAt)) {
    return { ok: false, reason: "required_field" };
  }
  const candidate = readCandidate(raw.candidate);
  if (!candidate || candidate.candidateVersion !== candidateVersion) {
    return { ok: false, reason: "candidate_invalid" };
  }
  return {
    ok: true,
    record: {
      schemaVersion: DIAGNOSIS_EVOLUTION_PREVIEW_SCHEMA_VERSION,
      kind: DIAGNOSIS_EVOLUTION_PREVIEW_KIND,
      tenantId,
      candidateVersion,
      candidate,
      createdAt,
      expiresAt,
    },
  };
}

function readCandidate(input: unknown): DiagnosisEvolutionPreviewCandidate | null {
  const skill = validateSkillInstallationCandidate(input);
  if (skill.ok) {
    return skill.candidate;
  }
  const structural = validateStructuralEvolutionCandidate(input);
  return structural.ok ? structural.candidate : null;
}

function writePreviewFile(
  configDir: string,
  record: DiagnosisEvolutionPreviewRecord,
): DiagnosisEvolutionPreviewRecord {
  const file = previewFilePath(configDir, record.tenantId, record.candidateVersion);
  if (!file) {
    throw new Error("preview path rejected");
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  rejectSymlink(dir, "directory");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  rejectSymlink(tmp, "file");
  fs.renameSync(tmp, file);
  return record;
}

function previewFilePath(
  configDir: string,
  tenantId: string,
  candidateVersion: string,
): string | null {
  if (
    candidateVersion.includes("..") ||
    candidateVersion.includes("/") ||
    candidateVersion.includes("\\")
  ) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(candidateVersion)) {
    return null;
  }
  const root = path.resolve(configDir, "diagnosis-evolution-previews");
  const tenantDir = path.resolve(
    root,
    createHash("sha256").update(tenantId).digest("hex").slice(0, 16),
  );
  const file = path.resolve(tenantDir, `${candidateVersion}.json`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return file;
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

function isIsoInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}
