/**
 * P5-e continuity restore + human-anchor review (L4).
 * Refs-only checkpoint restore. No Persona/Capability/OI merge. No anchor auto-activation.
 */
import { createHash } from "node:crypto";
import { isGovernanceActionAllowed } from "../governance-policy.js";
import { isRecord } from "../records.js";
import { readAgentAssetManifestPointer } from "./agent-asset-manifest-store.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import {
  mutateContinuityLongevityState,
  readContinuityLongevityState,
  readContinuityRestoreManifest,
  readContinuityRestorePointer,
  readTenantPolicyBaseline,
  writeContinuityRestoreSnapshot,
} from "./continuity-longevity-store.js";
import { isTenantKeyManagementAuth, type TenantKeyManagementAuth } from "./key-rotation-auth.js";
import {
  resolveAgentAssetManifestPointerRoot,
  resolveContinuityRestorePointerPath,
} from "./paths.js";
import type {
  AgentAssetContinuityManifest,
  AgentAssetManifestPointer,
  AnchorActivePointer,
  ContinuityCheckpointPackage,
  ContinuityRestoreReceipt,
  GovernanceApprovalAudit,
  HumanAnchorReviewReceipt,
  HumanVerifiedAnchor,
  HumanVerifiedAnchorRowKind,
  HumanVerifiedAnchorType,
} from "./types.js";

export type ContinuityLongevityDenyCode =
  | "actor_not_authorized"
  | "checkpoint_invalid"
  | "embedded_payload_forbidden"
  | "checksum_mismatch"
  | "tenant_mismatch"
  | "restore_namespace_corrupt"
  | "policy_baseline_missing"
  | "domain_merge_forbidden"
  | "anchor_auto_activation_forbidden"
  | "placement_authority_forbidden"
  | "mtime_truth_forbidden"
  | "continuity_longevity_corrupt";

export type ContinuityLongevityResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContinuityLongevityDenyCode };

export type ContinuityLongevityAuthParams = {
  auth: TenantKeyManagementAuth;
  stateDir: string;
  tenantId?: never;
};

const FORBIDDEN_EMBEDDED_KEYS = new Set([
  "persona",
  "personaBody",
  "capability",
  "capabilityBody",
  "capabilities",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "token",
  "apiKey",
  "password",
  "operationalIdentity",
  "oiPayload",
  "payload",
  "body",
]);

const CHECKPOINT_TOP_LEVEL_KEYS = new Set([
  "kind",
  "tenantId",
  "agentAssetId",
  "checkpointEpoch",
  "effectiveManifest",
  "anchorHistory",
  "anchorPointers",
  "checksum",
]);

const MANIFEST_ALLOWED_KEYS = new Set([
  "manifestId",
  "kind",
  "agentAssetId",
  "ownerScope",
  "personaVersionRef",
  "identityVersionRef",
  "capabilitySetVersionRef",
  "workingDnaVersionRef",
  "policyBaselineRef",
  "experienceCheckpointRef",
  "operationalIdentityBindingRefs",
  "previousManifestId",
  "contentKey",
  "approvalAudit",
  "reasonCode",
  "effectiveAt",
  "createdAt",
]);

const ANCHOR_ALLOWED_KEYS = new Set([
  "anchorId",
  "kind",
  "resourceId",
  "anchorType",
  "version",
  "rowKind",
  "approvalAudit",
  "evidenceRefs",
  "supersedesAnchorId",
  "effectiveAt",
  "createdAt",
]);

const ANCHOR_POINTER_ALLOWED_KEYS = new Set([
  "kind",
  "resourceId",
  "pointerState",
  "activeAnchorId",
  "revokedAnchorId",
  "revocationRowId",
  "anchorVersion",
  "revokedAt",
  "revokeMutationId",
  "pointerVersion",
  "lastMutationId",
  "updatedAt",
]);

const APPROVAL_AUDIT_ALLOWED_KEYS = new Set([
  "grantId",
  "approverUserId",
  "callerTenantId",
  "approvedAt",
]);

const MANIFEST_OWNER_SCOPES = new Set(["user_owned", "position_owned", "group_owned"]);
const ANCHOR_TYPES = new Set<HumanVerifiedAnchorType>([
  "identity",
  "principle",
  "commitment",
  "major_decision",
]);
const ANCHOR_ROW_KINDS = new Set<HumanVerifiedAnchorRowKind>([
  "proposal",
  "activation",
  "supersession",
  "revocation",
]);
const POINTER_STATES = new Set(["active", "revoked"]);

const MS_PER_DAY = 86_400_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasOnlyAllowedKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((key) => allowed.has(key));
}

/** Recursive scan: any forbidden key at any depth rejects refs-only checkpoint payloads. */
function findForbiddenEmbeddedKeyDeep(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => findForbiddenEmbeddedKeyDeep(item));
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_EMBEDDED_KEYS.has(key)) {
      return true;
    }
    if (findForbiddenEmbeddedKeyDeep(child)) {
      return true;
    }
  }
  return false;
}

function parseApprovalAudit(value: unknown): GovernanceApprovalAudit | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, APPROVAL_AUDIT_ALLOWED_KEYS)) {
    return null;
  }
  if (
    !isNonEmptyString(value.grantId) ||
    !isNonEmptyString(value.approverUserId) ||
    !(value.callerTenantId === null || isNonEmptyString(value.callerTenantId)) ||
    !isNonEmptyString(value.approvedAt)
  ) {
    return null;
  }
  return {
    grantId: value.grantId,
    approverUserId: value.approverUserId,
    callerTenantId: value.callerTenantId,
    approvedAt: value.approvedAt,
  };
}

function parseContinuityManifest(value: unknown): AgentAssetContinuityManifest | null {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, MANIFEST_ALLOWED_KEYS)) {
    return null;
  }
  if (
    value.kind !== "agent_asset_continuity_manifest" ||
    !isNonEmptyString(value.manifestId) ||
    !isNonEmptyString(value.agentAssetId) ||
    !MANIFEST_OWNER_SCOPES.has(String(value.ownerScope)) ||
    !isNonEmptyString(value.identityVersionRef) ||
    !isNonEmptyString(value.capabilitySetVersionRef) ||
    !isNonEmptyString(value.policyBaselineRef) ||
    !Array.isArray(value.operationalIdentityBindingRefs) ||
    !value.operationalIdentityBindingRefs.every((ref) => isNonEmptyString(ref)) ||
    !isNonEmptyString(value.contentKey) ||
    !isNonEmptyString(value.reasonCode) ||
    !isNonEmptyString(value.effectiveAt) ||
    !isNonEmptyString(value.createdAt)
  ) {
    return null;
  }
  if (value.personaVersionRef !== undefined && !isNonEmptyString(value.personaVersionRef)) {
    return null;
  }
  if (value.workingDnaVersionRef !== undefined && !isNonEmptyString(value.workingDnaVersionRef)) {
    return null;
  }
  if (
    value.experienceCheckpointRef !== undefined &&
    !isNonEmptyString(value.experienceCheckpointRef)
  ) {
    return null;
  }
  if (value.previousManifestId !== undefined && !isNonEmptyString(value.previousManifestId)) {
    return null;
  }
  const approvalAudit = parseApprovalAudit(value.approvalAudit);
  if (value.approvalAudit !== undefined && approvalAudit === null) {
    return null;
  }
  return {
    manifestId: value.manifestId,
    kind: "agent_asset_continuity_manifest",
    agentAssetId: value.agentAssetId,
    ownerScope: value.ownerScope as AgentAssetContinuityManifest["ownerScope"],
    personaVersionRef: value.personaVersionRef,
    identityVersionRef: value.identityVersionRef,
    capabilitySetVersionRef: value.capabilitySetVersionRef,
    workingDnaVersionRef: value.workingDnaVersionRef,
    policyBaselineRef: value.policyBaselineRef,
    experienceCheckpointRef: value.experienceCheckpointRef,
    operationalIdentityBindingRefs: value.operationalIdentityBindingRefs,
    previousManifestId: value.previousManifestId,
    contentKey: value.contentKey,
    approvalAudit: approvalAudit ?? undefined,
    reasonCode: value.reasonCode,
    effectiveAt: value.effectiveAt,
    createdAt: value.createdAt,
  };
}

function parseHumanVerifiedAnchor(value: unknown): HumanVerifiedAnchor | null {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, ANCHOR_ALLOWED_KEYS)) {
    return null;
  }
  if (
    value.kind !== "human_verified_anchor" ||
    !isNonEmptyString(value.anchorId) ||
    !isNonEmptyString(value.resourceId) ||
    !ANCHOR_TYPES.has(value.anchorType as HumanVerifiedAnchorType) ||
    typeof value.version !== "number" ||
    !Number.isFinite(value.version) ||
    !ANCHOR_ROW_KINDS.has(value.rowKind as HumanVerifiedAnchorRowKind) ||
    !Array.isArray(value.evidenceRefs) ||
    !value.evidenceRefs.every((ref) => isNonEmptyString(ref)) ||
    !isNonEmptyString(value.effectiveAt) ||
    !isNonEmptyString(value.createdAt)
  ) {
    return null;
  }
  if (value.supersedesAnchorId !== undefined && !isNonEmptyString(value.supersedesAnchorId)) {
    return null;
  }
  const approvalAudit = parseApprovalAudit(value.approvalAudit);
  if (value.approvalAudit !== undefined && approvalAudit === null) {
    return null;
  }
  return {
    anchorId: value.anchorId,
    kind: "human_verified_anchor",
    resourceId: value.resourceId,
    anchorType: value.anchorType as HumanVerifiedAnchorType,
    version: value.version,
    rowKind: value.rowKind as HumanVerifiedAnchorRowKind,
    approvalAudit: approvalAudit ?? undefined,
    evidenceRefs: value.evidenceRefs,
    supersedesAnchorId: value.supersedesAnchorId,
    effectiveAt: value.effectiveAt,
    createdAt: value.createdAt,
  };
}

function parseAnchorActivePointer(value: unknown): AnchorActivePointer | null {
  if (!isRecord(value) || !hasOnlyAllowedKeys(value, ANCHOR_POINTER_ALLOWED_KEYS)) {
    return null;
  }
  if (
    value.kind !== "anchor_active_pointer" ||
    !isNonEmptyString(value.resourceId) ||
    !POINTER_STATES.has(String(value.pointerState)) ||
    typeof value.anchorVersion !== "number" ||
    !Number.isFinite(value.anchorVersion) ||
    typeof value.pointerVersion !== "number" ||
    !Number.isFinite(value.pointerVersion) ||
    !isNonEmptyString(value.lastMutationId) ||
    !isNonEmptyString(value.updatedAt)
  ) {
    return null;
  }
  if (value.activeAnchorId !== undefined && !isNonEmptyString(value.activeAnchorId)) {
    return null;
  }
  if (value.revokedAnchorId !== undefined && !isNonEmptyString(value.revokedAnchorId)) {
    return null;
  }
  if (value.revocationRowId !== undefined && !isNonEmptyString(value.revocationRowId)) {
    return null;
  }
  if (value.revokedAt !== undefined && !isNonEmptyString(value.revokedAt)) {
    return null;
  }
  if (value.revokeMutationId !== undefined && !isNonEmptyString(value.revokeMutationId)) {
    return null;
  }
  return {
    kind: "anchor_active_pointer",
    resourceId: value.resourceId,
    pointerState: value.pointerState as AnchorActivePointer["pointerState"],
    activeAnchorId: value.activeAnchorId,
    revokedAnchorId: value.revokedAnchorId,
    revocationRowId: value.revocationRowId,
    anchorVersion: value.anchorVersion,
    revokedAt: value.revokedAt,
    revokeMutationId: value.revokeMutationId,
    pointerVersion: value.pointerVersion,
    lastMutationId: value.lastMutationId,
    updatedAt: value.updatedAt,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function authorizeTenant(
  params: ContinuityLongevityAuthParams & { action: "read" | "write" },
): ContinuityLongevityResult<{ tenantId: string }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isTenantKeyManagementAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.auth.callerTenantId.trim();
  if (!tenantId || params.auth.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const allowed = isGovernanceActionAllowed(
    { role: params.auth.role, tenantId, userId: params.auth.actor.userId },
    params.action,
    { kind: "tenant", tenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId } };
}

export function checkpointChecksum(input: Omit<ContinuityCheckpointPackage, "checksum">): string {
  return sha256(
    Buffer.from(
      canonicalizeCognitiveJson({
        tenantId: input.tenantId,
        agentAssetId: input.agentAssetId,
        checkpointEpoch: input.checkpointEpoch,
        effectiveManifest: input.effectiveManifest,
        anchorHistory: input.anchorHistory,
        anchorPointers: input.anchorPointers,
      }),
      "utf8",
    ),
  );
}

export function validateContinuityCheckpoint(
  checkpoint: unknown,
): ContinuityLongevityResult<ContinuityCheckpointPackage> {
  if (!isRecord(checkpoint)) {
    return { ok: false, error: "checkpoint_invalid" };
  }
  const raw = checkpoint;
  for (const key of Object.keys(raw)) {
    if (!CHECKPOINT_TOP_LEVEL_KEYS.has(key)) {
      return {
        ok: false,
        error: FORBIDDEN_EMBEDDED_KEYS.has(key)
          ? "embedded_payload_forbidden"
          : "checkpoint_invalid",
      };
    }
  }
  if (findForbiddenEmbeddedKeyDeep(raw)) {
    return { ok: false, error: "embedded_payload_forbidden" };
  }
  if (raw.kind !== "p5_continuity_checkpoint") {
    return { ok: false, error: "checkpoint_invalid" };
  }
  if (
    !isNonEmptyString(raw.tenantId) ||
    !isNonEmptyString(raw.agentAssetId) ||
    !isNonEmptyString(raw.checkpointEpoch) ||
    !isNonEmptyString(raw.checksum) ||
    !Array.isArray(raw.anchorHistory) ||
    !Array.isArray(raw.anchorPointers)
  ) {
    return { ok: false, error: "checkpoint_invalid" };
  }
  const effectiveManifest = parseContinuityManifest(raw.effectiveManifest);
  if (!effectiveManifest) {
    return { ok: false, error: "checkpoint_invalid" };
  }
  if (effectiveManifest.agentAssetId !== raw.agentAssetId) {
    return { ok: false, error: "checkpoint_invalid" };
  }
  const anchorHistory: HumanVerifiedAnchor[] = [];
  for (const row of raw.anchorHistory) {
    const parsed = parseHumanVerifiedAnchor(row);
    if (!parsed) {
      return { ok: false, error: "checkpoint_invalid" };
    }
    anchorHistory.push(parsed);
  }
  const anchorPointers: AnchorActivePointer[] = [];
  for (const row of raw.anchorPointers) {
    const parsed = parseAnchorActivePointer(row);
    if (!parsed) {
      return { ok: false, error: "checkpoint_invalid" };
    }
    anchorPointers.push(parsed);
  }
  const parsed: ContinuityCheckpointPackage = {
    kind: "p5_continuity_checkpoint",
    tenantId: raw.tenantId,
    agentAssetId: raw.agentAssetId,
    checkpointEpoch: raw.checkpointEpoch,
    effectiveManifest,
    anchorHistory,
    anchorPointers,
    checksum: raw.checksum,
  };
  if (checkpointChecksum(parsed) !== parsed.checksum) {
    return { ok: false, error: "checksum_mismatch" };
  }
  return { ok: true, value: parsed };
}

function persistFailedRestore(params: {
  stateDir: string;
  tenantId: string;
  replayId: string;
  agentAssetId: string;
  checkpointEpoch: string;
  restoredAt: string;
  error: ContinuityLongevityDenyCode;
}): ContinuityLongevityResult<never> {
  const receipt: ContinuityRestoreReceipt = {
    kind: "p5_continuity_restore_receipt",
    receiptId: `crr_${sha256(Buffer.from(params.replayId, "utf8"))}`,
    replayId: params.replayId,
    tenantId: params.tenantId,
    agentAssetId: params.agentAssetId,
    checkpointEpoch: params.checkpointEpoch,
    restoredManifestId: "",
    restoredAt: params.restoredAt,
    state: "failed",
  };
  mutateContinuityLongevityState({
    stateDir: params.stateDir,
    tenantId: params.tenantId,
    fn: (state) => ({
      ok: true,
      value: receipt,
      state: {
        ...state,
        restoreReceipts: { ...state.restoreReceipts, [params.replayId]: receipt },
      },
    }),
  });
  return { ok: false, error: params.error };
}

export async function runContinuityRestoreDrill(
  params: ContinuityLongevityAuthParams & { checkpoint: unknown; now: string },
): Promise<ContinuityLongevityResult<ContinuityRestoreReceipt>> {
  const authorized = authorizeTenant({ ...params, action: "write" });
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const productionPointerRoot = resolveAgentAssetManifestPointerRoot(params.stateDir);
  const validated = validateContinuityCheckpoint(params.checkpoint);
  if (!validated.ok) {
    return validated;
  }
  const checkpoint = validated.value;
  if (checkpoint.tenantId !== tenantId) {
    return { ok: false, error: "tenant_mismatch" };
  }
  const isolatedPointer = resolveContinuityRestorePointerPath(
    params.stateDir,
    tenantId,
    checkpoint.agentAssetId,
  );
  if (isolatedPointer.startsWith(productionPointerRoot)) {
    return { ok: false, error: "restore_namespace_corrupt" };
  }
  const replayId = `continuity-restore:${tenantId}:${checkpoint.agentAssetId}:${checkpoint.checkpointEpoch}`;
  const existing = readContinuityLongevityState({ stateDir: params.stateDir, tenantId })
    ?.restoreReceipts[replayId];
  if (existing?.state === "applied") {
    return { ok: true, value: existing };
  }
  const fail = (error: ContinuityLongevityDenyCode) =>
    persistFailedRestore({
      stateDir: params.stateDir,
      tenantId,
      replayId,
      agentAssetId: checkpoint.agentAssetId,
      checkpointEpoch: checkpoint.checkpointEpoch,
      restoredAt: params.now,
      error,
    });
  const manifest: AgentAssetContinuityManifest = {
    ...checkpoint.effectiveManifest,
    agentAssetId: checkpoint.agentAssetId,
  };
  const pointer: AgentAssetManifestPointer = {
    kind: "agent_asset_manifest_pointer",
    agentAssetId: checkpoint.agentAssetId,
    activeManifestId: manifest.manifestId,
    pointerVersion: 1,
    lastMutationId: replayId,
    updatedAt: params.now,
  };
  try {
    writeContinuityRestoreSnapshot({
      stateDir: params.stateDir,
      tenantId,
      agentAssetId: checkpoint.agentAssetId,
      manifest,
      pointer,
      now: params.now,
    });
    const loadedPointer = readContinuityRestorePointer({
      stateDir: params.stateDir,
      tenantId,
      agentAssetId: checkpoint.agentAssetId,
    });
    const loadedManifest = readContinuityRestoreManifest({
      stateDir: params.stateDir,
      tenantId,
      agentAssetId: checkpoint.agentAssetId,
      manifestId: manifest.manifestId,
    });
    if (
      !loadedPointer ||
      loadedPointer.activeManifestId !== manifest.manifestId ||
      !loadedManifest ||
      loadedManifest.manifestId !== manifest.manifestId
    ) {
      return fail("restore_namespace_corrupt");
    }
    const productionPointer = readAgentAssetManifestPointer({
      agentAssetId: checkpoint.agentAssetId,
      stateDir: params.stateDir,
    });
    if (productionPointer?.activeManifestId === manifest.manifestId) {
      return fail("restore_namespace_corrupt");
    }
  } catch {
    return fail("restore_namespace_corrupt");
  }
  const receipt: ContinuityRestoreReceipt = {
    kind: "p5_continuity_restore_receipt",
    receiptId: `crr_${sha256(Buffer.from(replayId, "utf8"))}`,
    replayId,
    tenantId,
    agentAssetId: checkpoint.agentAssetId,
    checkpointEpoch: checkpoint.checkpointEpoch,
    restoredManifestId: manifest.manifestId,
    restoredAt: params.now,
    state: "applied",
  };
  const mutated = mutateContinuityLongevityState({
    stateDir: params.stateDir,
    tenantId,
    fn: (state) => {
      const prior = state.restoreReceipts[replayId];
      if (prior?.state === "applied") {
        return { ok: true, value: prior, state };
      }
      return {
        ok: true,
        value: receipt,
        state: {
          ...state,
          restoreReceipts: { ...state.restoreReceipts, [replayId]: receipt },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: "continuity_longevity_corrupt" };
}

export async function runHumanAnchorReview(
  params: ContinuityLongevityAuthParams & {
    now: string;
    reviewCadenceDays?: number;
    agentAssetIds: readonly string[];
    anchorReviewCandidates?: readonly {
      resourceId: string;
      anchorType: string;
      lastReviewedAt?: string;
    }[];
  },
): Promise<ContinuityLongevityResult<HumanAnchorReviewReceipt>> {
  const authorized = authorizeTenant({ ...params, action: "read" });
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const baseline = readTenantPolicyBaseline({ stateDir: params.stateDir, tenantId });
  if (!baseline) {
    return { ok: false, error: "policy_baseline_missing" };
  }
  const cadenceMs = (params.reviewCadenceDays ?? 90) * MS_PER_DAY;
  const reviewedAtMs = Date.parse(params.now);
  const anchorReviewDue: Array<{ resourceId: string; anchorType: string; code: string }> = [];
  for (const candidate of params.anchorReviewCandidates ?? []) {
    const lastMs = candidate.lastReviewedAt ? Date.parse(candidate.lastReviewedAt) : 0;
    if (!Number.isFinite(lastMs) || reviewedAtMs - lastMs >= cadenceMs) {
      anchorReviewDue.push({
        resourceId: candidate.resourceId,
        anchorType: candidate.anchorType,
        code: "anchor_review_due",
      });
    }
  }
  const stalePolicyBaselines: Array<{
    agentAssetId: string;
    manifestPolicyRef: string;
    currentBaselineRef: string;
  }> = [];
  for (const agentAssetId of params.agentAssetIds) {
    const restored = readContinuityRestorePointer({
      stateDir: params.stateDir,
      tenantId,
      agentAssetId,
    });
    const manifestId = restored?.activeManifestId;
    const manifest = manifestId
      ? readContinuityRestoreManifest({
          stateDir: params.stateDir,
          tenantId,
          agentAssetId,
          manifestId,
        })
      : null;
    if (
      manifest &&
      manifest.policyBaselineRef &&
      manifest.policyBaselineRef !== baseline.currentBaselineRef
    ) {
      stalePolicyBaselines.push({
        agentAssetId,
        manifestPolicyRef: manifest.policyBaselineRef,
        currentBaselineRef: baseline.currentBaselineRef,
      });
    }
  }
  const receiptId = `har_${sha256(Buffer.from(`${tenantId}:${params.now}`, "utf8"))}`;
  const receipt: HumanAnchorReviewReceipt = {
    kind: "p5_human_anchor_review_receipt",
    receiptId,
    tenantId,
    reviewedAt: params.now,
    anchorReviewDue,
    stalePolicyBaselines,
    state: "applied",
  };
  const mutated = mutateContinuityLongevityState({
    stateDir: params.stateDir,
    tenantId,
    fn: (state) => ({
      ok: true,
      value: receipt,
      state: {
        ...state,
        lastReviewAt: params.now,
        reviewReceipts: { ...state.reviewReceipts, [receiptId]: receipt },
      },
    }),
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: "continuity_longevity_corrupt" };
}

export function refuseContinuityDomainMerge(): ContinuityLongevityResult<never> {
  return { ok: false, error: "domain_merge_forbidden" };
}

export function refuseAnchorAutoActivationFromReview(): ContinuityLongevityResult<never> {
  return { ok: false, error: "anchor_auto_activation_forbidden" };
}

export function refusePlacementFromContinuityReview(): ContinuityLongevityResult<never> {
  return { ok: false, error: "placement_authority_forbidden" };
}

export function refuseContinuityMtimeAsTruth(): ContinuityLongevityResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}
