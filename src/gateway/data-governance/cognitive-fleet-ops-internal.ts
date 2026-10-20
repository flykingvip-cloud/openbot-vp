import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  compareCognitiveBuildSequence,
  hashCognitiveFleetEvidence,
  parseCognitiveBuildSequence,
  parseCognitiveFleetOpsAuthority,
  readCognitiveFleetOpsAuthority,
  readEnvelopeV2ReadCompatReceipt,
  resolveCognitiveFleetOpsAuthorityPath,
  resolveEnvelopeV2DualReadReceiptPath,
  resolveEnvelopeV2WriteUnlockReceiptPath,
} from "./cognitive-write-unlock.js";
import type {
  CognitiveFleetNodeEvidence,
  CognitiveFleetOpsAuthority,
  EnvelopeV2ReadCompatReceipt,
  EnvelopeV2WriteUnlockReceipt,
} from "./types.js";

const OPS_BRAND = Symbol("openbot.cognitiveFleetOpsAuth");
const FLEET_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type CognitiveFleetNodeBuild = {
  buildId: string;
  buildSequence: number;
};

export type CognitiveFleetOpsAuth = {
  readonly [OPS_BRAND]: true;
  readonly opsId: string;
  readonly minBuildSequence: number;
  readonly nodeIds: string[];
};

function writeDurable(dest: string, value: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

function fleetToken(value: string, label: string): string {
  if (!FLEET_TOKEN.test(value) || value.includes("..")) {
    throw new Error(`governance_cognitive_denied:invalid_${label}`);
  }
  return value;
}

function requireBuildSequence(value: number, label: string): number {
  const parsed = parseCognitiveBuildSequence(value);
  if (parsed === null) {
    throw new Error(`governance_cognitive_denied:invalid_${label}`);
  }
  return parsed;
}

function sortedUniqueNodeIds(nodeIds: string[]): string[] {
  if (nodeIds.length === 0) {
    throw new Error("governance_cognitive_denied:empty_fleet");
  }
  const tokens = nodeIds.map((nodeId) => fleetToken(nodeId, "nodeId"));
  const unique = new Set(tokens);
  if (unique.size !== tokens.length) {
    throw new Error("governance_cognitive_denied:duplicate_node");
  }
  return [...tokens].toSorted();
}

export function hashCognitiveFleetOpsToken(opsId: string, deployToken: string): string {
  return createHash("sha256").update(`${opsId}\0${deployToken}`).digest("hex");
}

export function isCognitiveFleetOpsAuth(value: unknown): value is CognitiveFleetOpsAuth {
  return Boolean(value && typeof value === "object" && (value as CognitiveFleetOpsAuth)[OPS_BRAND]);
}

function requireOpsAuth(auth: unknown): CognitiveFleetOpsAuth {
  if (!isCognitiveFleetOpsAuth(auth)) {
    throw new Error("governance_cognitive_denied:fleet_ops_auth_required");
  }
  return auth;
}

/** Deploy-boundary root of trust. Not a production barrel export. */
export function installCognitiveFleetOpsAuthority(params: {
  stateDir: string;
  opsId: string;
  deployToken: string;
  minBuildSequence: number;
  nodeIds: string[];
}): CognitiveFleetOpsAuthority {
  const opsId = fleetToken(params.opsId, "opsId");
  const minBuildSequence = requireBuildSequence(params.minBuildSequence, "minBuildSequence");
  if (typeof params.deployToken !== "string" || params.deployToken.length < 16) {
    throw new Error("governance_cognitive_denied:deploy_token_required");
  }
  const authority: CognitiveFleetOpsAuthority = {
    kind: "cognitive_fleet_ops_authority",
    opsId,
    tokenHash: hashCognitiveFleetOpsToken(opsId, params.deployToken),
    minBuildSequence,
    nodeIds: sortedUniqueNodeIds(params.nodeIds),
  };
  writeDurable(resolveCognitiveFleetOpsAuthorityPath(params.stateDir), authority);
  return authority;
}

export function authenticateCognitiveFleetOps(params: {
  stateDir: string;
  opsId: string;
  deployToken: string;
}): CognitiveFleetOpsAuth {
  const authority = readCognitiveFleetOpsAuthority(params.stateDir);
  if (!authority || !parseCognitiveFleetOpsAuthority(authority)) {
    throw new Error("governance_cognitive_denied:fleet_ops_authority_required");
  }
  const opsId = fleetToken(params.opsId, "opsId");
  if (opsId !== authority.opsId) {
    throw new Error("governance_cognitive_denied:fleet_ops_identity_mismatch");
  }
  if (hashCognitiveFleetOpsToken(opsId, params.deployToken) !== authority.tokenHash) {
    throw new Error("governance_cognitive_denied:fleet_ops_token_mismatch");
  }
  return Object.freeze({
    [OPS_BRAND]: true as const,
    opsId: authority.opsId,
    minBuildSequence: authority.minBuildSequence,
    nodeIds: [...authority.nodeIds],
  });
}

export function issueEnvelopeV2DualReadReceipt(params: {
  auth: CognitiveFleetOpsAuth;
  stateDir: string;
  receiptId: string;
  nodeBuilds: Record<string, CognitiveFleetNodeBuild>;
}): EnvelopeV2ReadCompatReceipt {
  const auth = requireOpsAuth(params.auth);
  const authority = readCognitiveFleetOpsAuthority(params.stateDir);
  if (
    !authority ||
    authority.opsId !== auth.opsId ||
    authority.minBuildSequence !== auth.minBuildSequence ||
    authority.nodeIds.join("\0") !== auth.nodeIds.join("\0")
  ) {
    throw new Error("governance_cognitive_denied:fleet_ops_authority_mismatch");
  }
  const buildKeys = Object.keys(params.nodeBuilds).toSorted();
  if (buildKeys.join("\0") !== auth.nodeIds.join("\0")) {
    throw new Error("governance_cognitive_denied:fleet_node_coverage");
  }
  const nodeEvidence: CognitiveFleetNodeEvidence[] = auth.nodeIds.map((nodeId) => {
    const entry = params.nodeBuilds[nodeId];
    const buildId = fleetToken(entry?.buildId ?? "", "buildId");
    const buildSequence = requireBuildSequence(entry?.buildSequence ?? NaN, "buildSequence");
    if (compareCognitiveBuildSequence(buildSequence, auth.minBuildSequence) < 0) {
      throw new Error("governance_cognitive_denied:build_below_floor");
    }
    return { nodeId, buildId, buildSequence };
  });
  const receipt: EnvelopeV2ReadCompatReceipt = {
    receiptId: fleetToken(params.receiptId, "receiptId"),
    kind: "envelope_v2_dual_read_r0",
    minBuildSequence: auth.minBuildSequence,
    nodeIds: [...auth.nodeIds],
    nodeEvidence,
    acceptsSchemaVersions: [1, 2],
    cognitiveWrites: "locked",
    evidenceHash: hashCognitiveFleetEvidence({
      minBuildSequence: auth.minBuildSequence,
      nodeIds: auth.nodeIds,
      nodeEvidence,
    }),
    createdAt: new Date().toISOString(),
  };
  writeDurable(resolveEnvelopeV2DualReadReceiptPath(params.stateDir), receipt);
  return receipt;
}

export function issueEnvelopeV2WriteUnlockReceipt(params: {
  auth: CognitiveFleetOpsAuth;
  stateDir: string;
  receiptId: string;
}): EnvelopeV2WriteUnlockReceipt {
  const auth = requireOpsAuth(params.auth);
  const r0 = readEnvelopeV2ReadCompatReceipt(params.stateDir);
  if (!r0) {
    throw new Error("governance_cognitive_denied:r0_receipt_required");
  }
  if (
    r0.minBuildSequence !== auth.minBuildSequence ||
    r0.nodeIds.join("\0") !== auth.nodeIds.join("\0")
  ) {
    throw new Error("governance_cognitive_denied:r0_fleet_mismatch");
  }
  const receipt: EnvelopeV2WriteUnlockReceipt = {
    receiptId: fleetToken(params.receiptId, "receiptId"),
    kind: "envelope_v2_write_unlock_r1",
    minBuildSequence: auth.minBuildSequence,
    requiredKind: "envelope_v2_dual_read_r0",
    r0ReceiptId: r0.receiptId,
    r0EvidenceHash: r0.evidenceHash,
    nodeIds: [...auth.nodeIds],
    attestedBy: { kind: "deploy_ops", opsId: auth.opsId },
    createdAt: new Date().toISOString(),
  };
  writeDurable(resolveEnvelopeV2WriteUnlockReceiptPath(params.stateDir), receipt);
  return receipt;
}
