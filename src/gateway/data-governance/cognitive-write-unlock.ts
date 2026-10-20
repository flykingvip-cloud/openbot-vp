import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { recordOrNull as asRecord } from "../records.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import { resolveCognitiveFleetReceiptRoot } from "./paths.js";
import type {
  CognitiveFleetNodeEvidence,
  CognitiveFleetOpsAuthority,
  CognitiveFleetOpsAttestor,
  EnvelopeV2ReadCompatReceipt,
  EnvelopeV2WriteUnlockReceipt,
} from "./types.js";

const FLEET_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const AUTHORITY_KEYS = ["kind", "opsId", "tokenHash", "minBuildSequence", "nodeIds"] as const;
const R0_KEYS = [
  "receiptId",
  "kind",
  "minBuildSequence",
  "nodeIds",
  "nodeEvidence",
  "acceptsSchemaVersions",
  "cognitiveWrites",
  "evidenceHash",
  "createdAt",
] as const;
const R1_KEYS = [
  "receiptId",
  "kind",
  "minBuildSequence",
  "requiredKind",
  "r0ReceiptId",
  "r0EvidenceHash",
  "nodeIds",
  "attestedBy",
  "createdAt",
] as const;
const NODE_EVIDENCE_KEYS = ["nodeId", "buildId", "buildSequence"] as const;
const ATTESTOR_KEYS = ["kind", "opsId"] as const;

function fleetRoot(stateDir?: string): string {
  return resolveCognitiveFleetReceiptRoot(stateDir ?? resolveStateDir());
}

export function resolveCognitiveFleetOpsAuthorityPath(stateDir?: string): string {
  return path.join(fleetRoot(stateDir), "ops-authority.json");
}

export function resolveEnvelopeV2DualReadReceiptPath(stateDir?: string): string {
  return path.join(fleetRoot(stateDir), "envelope-v2-dual-read-r0.json");
}

export function resolveEnvelopeV2WriteUnlockReceiptPath(stateDir?: string): string {
  return path.join(fleetRoot(stateDir), "envelope-v2-write-unlock-r1.json");
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fleetToken(value: unknown): string | null {
  if (typeof value !== "string" || !FLEET_TOKEN.test(value) || value.includes("..")) {
    return null;
  }
  return value;
}

function createdAt(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_CREATED_AT.test(value)) {
    return null;
  }
  return value;
}

function sha256Hex(value: unknown): string | null {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    return null;
  }
  return value;
}

/** Deploy-system monotonic build counter. Rejects strings and non-safe integers. */
export function parseCognitiveBuildSequence(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    !Number.isSafeInteger(value)
  ) {
    return null;
  }
  return value;
}

export function compareCognitiveBuildSequence(left: number, right: number): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function parseSortedUniqueNodeIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const nodeIds: string[] = [];
  for (const entry of value) {
    const nodeId = fleetToken(entry);
    if (!nodeId) {
      return null;
    }
    nodeIds.push(nodeId);
  }
  const unique = new Set(nodeIds);
  if (unique.size !== nodeIds.length) {
    return null;
  }
  const sorted = [...nodeIds].toSorted();
  if (nodeIds.some((nodeId, index) => nodeId !== sorted[index])) {
    return null;
  }
  return nodeIds;
}

function sameNodeIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((nodeId, index) => nodeId === right[index]);
}

export function hashCognitiveFleetEvidence(input: {
  minBuildSequence: number;
  nodeIds: string[];
  nodeEvidence: CognitiveFleetNodeEvidence[];
}): string {
  return createHash("sha256")
    .update(
      canonicalizeCognitiveJson({
        kind: "envelope_v2_dual_read_r0",
        minBuildSequence: input.minBuildSequence,
        nodeIds: input.nodeIds,
        nodeEvidence: input.nodeEvidence,
        acceptsSchemaVersions: [1, 2],
        cognitiveWrites: "locked",
      }),
    )
    .digest("hex");
}

function parseNodeEvidence(
  value: unknown,
  nodeIds: string[],
  minBuildSequence: number,
): CognitiveFleetNodeEvidence[] | null {
  if (!Array.isArray(value) || value.length !== nodeIds.length) {
    return null;
  }
  const evidence: CognitiveFleetNodeEvidence[] = [];
  for (const [index, entry] of value.entries()) {
    const record = asRecord(entry);
    if (!record || !exactKeys(record, NODE_EVIDENCE_KEYS)) {
      return null;
    }
    const nodeId = fleetToken(record.nodeId);
    const buildId = fleetToken(record.buildId);
    const buildSequence = parseCognitiveBuildSequence(record.buildSequence);
    if (!nodeId || !buildId || buildSequence === null || nodeId !== nodeIds[index]) {
      return null;
    }
    if (compareCognitiveBuildSequence(buildSequence, minBuildSequence) < 0) {
      return null;
    }
    evidence.push({ nodeId, buildId, buildSequence });
  }
  return evidence;
}

function parseAttestor(value: unknown): CognitiveFleetOpsAttestor | null {
  const record = asRecord(value);
  if (!record || !exactKeys(record, ATTESTOR_KEYS) || record.kind !== "deploy_ops") {
    return null;
  }
  const opsId = fleetToken(record.opsId);
  if (!opsId) {
    return null;
  }
  return { kind: "deploy_ops", opsId };
}

function readJson(dest: string): unknown {
  try {
    if (!fs.existsSync(dest)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    return null;
  }
}

export function parseCognitiveFleetOpsAuthority(value: unknown): CognitiveFleetOpsAuthority | null {
  const record = asRecord(value);
  if (!record || !exactKeys(record, AUTHORITY_KEYS)) {
    return null;
  }
  if (record.kind !== "cognitive_fleet_ops_authority") {
    return null;
  }
  const opsId = fleetToken(record.opsId);
  const tokenHash = sha256Hex(record.tokenHash);
  const minBuildSequence = parseCognitiveBuildSequence(record.minBuildSequence);
  const nodeIds = parseSortedUniqueNodeIds(record.nodeIds);
  if (!opsId || !tokenHash || minBuildSequence === null || !nodeIds) {
    return null;
  }
  return { kind: "cognitive_fleet_ops_authority", opsId, tokenHash, minBuildSequence, nodeIds };
}

export function parseEnvelopeV2ReadCompatReceipt(
  value: unknown,
): EnvelopeV2ReadCompatReceipt | null {
  const record = asRecord(value);
  if (!record || !exactKeys(record, R0_KEYS) || record.kind !== "envelope_v2_dual_read_r0") {
    return null;
  }
  if (record.cognitiveWrites !== "locked") {
    return null;
  }
  if (
    !Array.isArray(record.acceptsSchemaVersions) ||
    record.acceptsSchemaVersions.length !== 2 ||
    record.acceptsSchemaVersions[0] !== 1 ||
    record.acceptsSchemaVersions[1] !== 2
  ) {
    return null;
  }
  const receiptId = fleetToken(record.receiptId);
  const minBuildSequence = parseCognitiveBuildSequence(record.minBuildSequence);
  const nodeIds = parseSortedUniqueNodeIds(record.nodeIds);
  const evidenceHash = sha256Hex(record.evidenceHash);
  const created = createdAt(record.createdAt);
  if (!receiptId || minBuildSequence === null || !nodeIds || !evidenceHash || !created) {
    return null;
  }
  const nodeEvidence = parseNodeEvidence(record.nodeEvidence, nodeIds, minBuildSequence);
  if (!nodeEvidence) {
    return null;
  }
  if (hashCognitiveFleetEvidence({ minBuildSequence, nodeIds, nodeEvidence }) !== evidenceHash) {
    return null;
  }
  return {
    receiptId,
    kind: "envelope_v2_dual_read_r0",
    minBuildSequence,
    nodeIds,
    nodeEvidence,
    acceptsSchemaVersions: [1, 2],
    cognitiveWrites: "locked",
    evidenceHash,
    createdAt: created,
  };
}

export function parseEnvelopeV2WriteUnlockReceipt(
  value: unknown,
): EnvelopeV2WriteUnlockReceipt | null {
  const record = asRecord(value);
  if (!record || !exactKeys(record, R1_KEYS) || record.kind !== "envelope_v2_write_unlock_r1") {
    return null;
  }
  if (record.requiredKind !== "envelope_v2_dual_read_r0") {
    return null;
  }
  const receiptId = fleetToken(record.receiptId);
  const minBuildSequence = parseCognitiveBuildSequence(record.minBuildSequence);
  const r0ReceiptId = fleetToken(record.r0ReceiptId);
  const r0EvidenceHash = sha256Hex(record.r0EvidenceHash);
  const nodeIds = parseSortedUniqueNodeIds(record.nodeIds);
  const created = createdAt(record.createdAt);
  const attestedBy = parseAttestor(record.attestedBy);
  if (
    !receiptId ||
    minBuildSequence === null ||
    !r0ReceiptId ||
    !r0EvidenceHash ||
    !nodeIds ||
    !created ||
    !attestedBy
  ) {
    return null;
  }
  return {
    receiptId,
    kind: "envelope_v2_write_unlock_r1",
    minBuildSequence,
    requiredKind: "envelope_v2_dual_read_r0",
    r0ReceiptId,
    r0EvidenceHash,
    nodeIds,
    attestedBy,
    createdAt: created,
  };
}

export function readCognitiveFleetOpsAuthority(
  stateDir?: string,
): CognitiveFleetOpsAuthority | null {
  return parseCognitiveFleetOpsAuthority(readJson(resolveCognitiveFleetOpsAuthorityPath(stateDir)));
}

export function readEnvelopeV2ReadCompatReceipt(
  stateDir?: string,
): EnvelopeV2ReadCompatReceipt | null {
  return parseEnvelopeV2ReadCompatReceipt(readJson(resolveEnvelopeV2DualReadReceiptPath(stateDir)));
}

export function readEnvelopeV2WriteUnlockReceipt(
  stateDir?: string,
): EnvelopeV2WriteUnlockReceipt | null {
  return parseEnvelopeV2WriteUnlockReceipt(
    readJson(resolveEnvelopeV2WriteUnlockReceiptPath(stateDir)),
  );
}

/**
 * Fail-closed fleet unlock. Authority, R0, and R1 must parse, cover the same
 * node set, share minBuildSequence, and bind R1 to the R0 evidence hash.
 */
export function isCognitiveWriteUnlocked(stateDir?: string): boolean {
  try {
    const authority = readCognitiveFleetOpsAuthority(stateDir);
    const r0 = readEnvelopeV2ReadCompatReceipt(stateDir);
    const r1 = readEnvelopeV2WriteUnlockReceipt(stateDir);
    if (!authority || !r0 || !r1) {
      return false;
    }
    if (
      r0.minBuildSequence !== authority.minBuildSequence ||
      r1.minBuildSequence !== authority.minBuildSequence
    ) {
      return false;
    }
    if (
      !sameNodeIds(r0.nodeIds, authority.nodeIds) ||
      !sameNodeIds(r1.nodeIds, authority.nodeIds)
    ) {
      return false;
    }
    if (r1.r0ReceiptId !== r0.receiptId || r1.r0EvidenceHash !== r0.evidenceHash) {
      return false;
    }
    return r1.attestedBy.opsId === authority.opsId;
  } catch {
    return false;
  }
}
