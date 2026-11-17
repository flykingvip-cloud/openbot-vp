/**
 * P0.0b — RoundPolicySnapshot (Floor Runtime v2.1 §2.4 / §5.2).
 *
 * Gated by `collaboration.policySnapshot` (plan name `collab.policySnapshot`),
 * default OFF. With the flag off, callers keep compiling at each site and no
 * snapshot body is persisted (golden output byte-identical to baseline).
 * With the flag on, each round compiles exactly once, deep-freezes the result,
 * and reuses the same frozen EffectivePolicy reference across consumers.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateExecutionRuleAdoption } from "../../agent-runtime/policy/rule-adaptation/index.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveLegacyGroupRuntimeFactPaths } from "../collaboration-learning/collaboration-paths.js";
import type { EffectiveCollaborationPolicy, GroupPolicyInput } from "./effective-policy.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import { deepFreeze, type DeepReadonly, type FrozenEffectivePolicy } from "./policy-identity.js";
import { observeGovernanceLanePolicyHashDivergence } from "./policy-lane-governance.js";
import {
  compileAndFreezeGroupPolicyInput,
  compileGroupEffectivePolicy,
  groupPolicySourceFromScope,
  resolveGroupPolicyInput,
} from "./resolve-effective-policy.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import type { CollaborationDispatchScope } from "./types.js";

// Re-exported for existing P0.0b callers; implementation lives in policy-identity.ts.
export {
  POLICY_COMPILER_REVISION,
  deepFreeze,
  hashProvenanceAndClamps,
  type DeepReadonly,
  type FrozenEffectivePolicy,
} from "./policy-identity.js";

/** Plan flag `collab.policySnapshot` → config `collaboration.policySnapshot` (default false). */
export function isCollabPolicySnapshotEnabled(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.policySnapshot === true;
}

/** Doc alias: GroupPolicySource ≡ GroupPolicyInput for P0.0b. */
export type GroupPolicySource = GroupPolicyInput;

export type RoundPolicySnapshot = Readonly<{
  /** Runtime identity: unique per createRoundPolicySnapshot ("pss_<ulid>"). */
  policySnapshotId: string;
  /** Content identity via hashEffectiveCollaborationPolicy (unchanged algorithm). */
  policyHash: string;
  /** Hash of provenance + clamps. */
  provenanceHash: string;
  /** Compiler implementation version; excluded from policyHash. */
  compilerRevision: string;
  effective: FrozenEffectivePolicy;
  input: DeepReadonly<GroupPolicyInput>;
  compiledAt: number;
}>;

/** Crockford Base32 alphabet (ULID). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return out;
}

/** ULID-shaped id: 48-bit timestamp + 80-bit randomness, Crockford Base32. */
export function generateUlid(nowMs: number = Date.now()): string {
  const ms = Math.max(0, Math.floor(nowMs));
  const time = new Uint8Array(6);
  let t = ms;
  for (let i = 5; i >= 0; i -= 1) {
    time[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  const rand = randomBytes(10);
  return encodeCrockford(time) + encodeCrockford(rand);
}

export function generatePolicySnapshotId(nowMs?: number): string {
  return `pss_${generateUlid(nowMs)}`;
}

export function createRoundPolicySnapshot(
  input: GroupPolicySource,
  opts: { now: number; idGen: () => string },
): RoundPolicySnapshot {
  // P1-A2: compile + clone + deep-freeze + hash share one implementation with the
  // composition root (resolveGroupEffectivePolicy). Clone before freeze so module
  // constants (MODE_TEMPLATES / SYSTEM_INVARIANTS / OBSERVER_PERMISSIONS) are never
  // frozen in place.
  const resolved = compileAndFreezeGroupPolicyInput(input);
  return {
    policySnapshotId: opts.idGen(),
    policyHash: resolved.policyHash,
    provenanceHash: resolved.provenanceHash,
    compilerRevision: resolved.compilerRevision,
    effective: resolved.effective,
    input: resolved.input,
    compiledAt: opts.now,
  };
}

export function createRoundPolicySnapshotFromScope(
  scope: CollaborationDispatchScope,
  opts?: { now?: number; idGen?: () => string; cfg?: OpenBotConfig },
): RoundPolicySnapshot {
  // P1-A2: input comes from the unique composition root.
  const source = groupPolicySourceFromScope(scope);
  const input = resolveGroupPolicyInput(source);
  const now = opts?.now ?? Date.now();
  const snapshot = createRoundPolicySnapshot(input, {
    now,
    idGen: opts?.idGen ?? (() => generatePolicySnapshotId(now)),
  });
  // P1-A5 final BP-17: shadow records learning vs dispatch overlay policyHash.
  // Legacy (default) = no-op (no extra compile).
  observeGovernanceLanePolicyHashDivergence({
    operatingState: source.operatingState ?? null,
    legacyOverlay: source.legacyOverlay ?? null,
    servedDispatchPolicyHash: snapshot.policyHash,
    cfg: opts?.cfg,
  });
  return snapshot;
}

/**
 * Resolve EffectivePolicy: prefer an injected snapshot (flag-on path); otherwise
 * compile through the composition root (flag-off / legacy path; not frozen, same
 * as before P1-A2 — freezing stays governed by `collaboration.policySnapshot`).
 */
export function resolveEffectivePolicy(
  scope: CollaborationDispatchScope,
  snapshot?: RoundPolicySnapshot | null,
): EffectiveCollaborationPolicy {
  if (snapshot) {
    return snapshot.effective as EffectiveCollaborationPolicy;
  }
  return compileGroupEffectivePolicy(groupPolicySourceFromScope(scope));
}

export type PolicySnapshotPersistPaths = {
  /** Content-addressed body directory. */
  policySnapshotsDir: string;
};

/**
 * Policy-snapshots dir: under `<ns>/policy-snapshots` when runtimeNamespace is on;
 * otherwise `<groupDir>/runtime/policy-snapshots` (alongside legacy rounds).
 */
export function resolvePolicySnapshotsDir(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): string {
  const cfg = params.cfg ?? loadConfig();
  const facts = resolveCollaborationRuntimeFactPaths({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg,
  });
  if (facts.namespace) {
    return facts.namespace.policySnapshotsDir;
  }
  const legacy = resolveLegacyGroupRuntimeFactPaths(params.groupId, cfg);
  return path.join(legacy.groupDir, "runtime", "policy-snapshots");
}

export type PersistedPolicySnapshotBody = {
  policyHash: string;
  provenanceHash: string;
  compilerRevision: string;
  compiledAt: number;
  input: GroupPolicyInput;
  effective: EffectiveCollaborationPolicy;
};

export function policySnapshotBodyPath(dir: string, policyHash: string): string {
  return path.join(dir, `${policyHash}.json`);
}

/**
 * Content-addressed write: same hash writes once (exist → no-op). Returns the path.
 */
export async function persistPolicySnapshotBody(params: {
  snapshot: RoundPolicySnapshot;
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): Promise<{ path: string; written: boolean }> {
  const dir = resolvePolicySnapshotsDir({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
  });
  await fs.mkdir(dir, { recursive: true });
  const target = policySnapshotBodyPath(dir, params.snapshot.policyHash);
  try {
    await fs.access(target);
    return { path: target, written: false };
  } catch {
    // not present — fall through
  }
  const body: PersistedPolicySnapshotBody = {
    policyHash: params.snapshot.policyHash,
    provenanceHash: params.snapshot.provenanceHash,
    compilerRevision: params.snapshot.compilerRevision,
    compiledAt: params.snapshot.compiledAt,
    input: params.snapshot.input as GroupPolicyInput,
    // Persist a plain (unfrozen) clone so JSON round-trips cleanly.
    effective: structuredClone(params.snapshot.effective) as EffectiveCollaborationPolicy,
  };
  const tmp = `${target}.${process.pid}.${generateUlid()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(body)}\n`, "utf8");
  await fs.rename(tmp, target);
  return { path: target, written: true };
}

export async function loadPolicySnapshotBody(params: {
  policyHash: string;
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): Promise<PersistedPolicySnapshotBody | null> {
  const dir = resolvePolicySnapshotsDir({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
  });
  const target = policySnapshotBodyPath(dir, params.policyHash);
  try {
    const raw = await fs.readFile(target, "utf8");
    return JSON.parse(raw) as PersistedPolicySnapshotBody;
  } catch {
    return null;
  }
}

/**
 * Replay helper (§2.4): given policySnapshotId + policyHash from an event key,
 * load the content-addressed body and return a deep-frozen EffectivePolicy whose
 * hash matches the key.
 */
export async function replayFrozenPolicyFromKey(params: {
  policySnapshotId: string;
  policyHash: string;
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): Promise<{
  policySnapshotId: string;
  policyHash: string;
  effective: FrozenEffectivePolicy;
  body: PersistedPolicySnapshotBody;
} | null> {
  const body = await loadPolicySnapshotBody(params);
  if (!body) {
    return null;
  }
  if (body.policyHash !== params.policyHash) {
    throw new Error(
      `policy snapshot hash mismatch: key=${params.policyHash} body=${body.policyHash}`,
    );
  }
  const recomputed = hashEffectiveCollaborationPolicy(body.effective);
  if (recomputed !== params.policyHash) {
    throw new Error(
      `policy snapshot body hash drift: stored=${params.policyHash} recomputed=${recomputed}`,
    );
  }
  return {
    policySnapshotId: params.policySnapshotId,
    policyHash: params.policyHash,
    effective: deepFreeze(structuredClone(body.effective)),
    body,
  };
}

/** Compile an adopted run-local ceiling through the same compiler/hash/freeze path. */
export function createAdoptedGroupReplySnapshot(params: {
  scope: CollaborationDispatchScope;
  proposedValue: number;
  proposalGroupId: string;
  authorized: boolean;
  bindingCurrent: boolean;
  cancelled: boolean;
  now: number;
}): RoundPolicySnapshot {
  const input = resolveGroupPolicyInput(groupPolicySourceFromScope(params.scope));
  const original = compileGroupEffectivePolicy(groupPolicySourceFromScope(params.scope));
  const decision = evaluateExecutionRuleAdoption({
    mode: "dynamic",
    authorized: params.authorized,
    scope: { type: "group", id: params.scope.groupId },
    proposalScope: { type: "group", id: params.proposalGroupId },
    bindingCurrent: params.bindingCurrent,
    cancelled: params.cancelled,
    ruleId: "collab.policy.compile",
    field: "maxVisibleBotRepliesPerRound",
    action: "tune",
    currentValue: original.participation.maxVisibleBotRepliesPerRound,
    proposedValue: params.proposedValue,
  });
  if (!decision.allowed) {
    throw new Error(`Group rule adoption rejected: ${decision.reason}`);
  }
  return createRoundPolicySnapshot(
    { ...input, maxVisibleBotRepliesPerRound: decision.value },
    {
      now: params.now,
      idGen: () => generatePolicySnapshotId(params.now),
    },
  );
}
