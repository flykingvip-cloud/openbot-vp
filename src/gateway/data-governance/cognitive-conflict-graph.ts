import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tenantPartition } from "./cognitive-approval-grant-store.js";
import {
  readJsonIfPresent,
  withCognitiveFileLock,
  writeJsonDurable,
} from "./cognitive-file-lock.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import { resolveCognitiveConflictRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  CognitiveConflictEdge,
  CognitiveConflictGraphHead,
  CognitiveConflictKind,
  CognitiveMergeReservation,
} from "./types.js";

const LOCK_TIMEOUT = "cognitive_conflict_graph_lock_timeout";

/** Fixed lease window; renewable once (§3.5.2). Liveness only — never a correctness gate. */
export const MERGE_RESERVATION_LEASE_MS = 60_000;

export function canonicalConflictPair(left: string, right: string): [string, string] {
  return left <= right ? [left, right] : [right, left];
}

export function conflictEdgeId(params: {
  leftResourceId: string;
  rightResourceId: string;
  conflictKind: CognitiveConflictKind;
}): string {
  const [left, right] = canonicalConflictPair(params.leftResourceId, params.rightResourceId);
  const digest = createHash("sha256")
    .update(canonicalizeCognitiveJson({ left, right, kind: params.conflictKind }))
    .digest("hex");
  return `cce-${digest.slice(0, 32)}`;
}

function partitionRoot(tenantId: string | null, stateDir: string): string {
  const partition = assertSafeRecoveryReceiptToken(tenantPartition(tenantId), "operationId");
  return path.resolve(resolveCognitiveConflictRoot(stateDir), partition);
}

function headPath(tenantId: string | null, stateDir: string): string {
  return path.join(partitionRoot(tenantId, stateDir), "graph-head.json");
}

function edgePath(params: { edgeId: string; tenantId: string | null; stateDir: string }): string {
  const edgeId = assertSafeRecoveryReceiptToken(params.edgeId, "operationId");
  const root = path.join(partitionRoot(params.tenantId, params.stateDir), "edges");
  const dest = path.resolve(root, `${edgeId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_conflict_edge_path");
  }
  return dest;
}

/** sha256 over the canonical sorted open-edge id list (§3.2). */
export function computeConflictGraphHash(openEdgeIds: string[]): string {
  return createHash("sha256")
    .update(canonicalizeCognitiveJson([...openEdgeIds].toSorted()))
    .digest("hex");
}

function emptyHead(tenantId: string | null): CognitiveConflictGraphHead {
  return {
    kind: "cognitive_conflict_graph_head",
    tenantId,
    graphVersion: 0,
    graphHash: computeConflictGraphHash([]),
    graphEpoch: 0,
    lastFencingToken: 0,
    reservation: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function parseHead(value: unknown, tenantId: string | null): CognitiveConflictGraphHead | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as CognitiveConflictGraphHead;
  if (
    raw.kind !== "cognitive_conflict_graph_head" ||
    typeof raw.graphVersion !== "number" ||
    typeof raw.graphEpoch !== "number" ||
    typeof raw.lastFencingToken !== "number" ||
    typeof raw.graphHash !== "string"
  ) {
    return null;
  }
  return { ...raw, tenantId };
}

export function readConflictGraphHead(params: {
  tenantId: string | null;
  stateDir: string;
}): CognitiveConflictGraphHead {
  const parsed = parseHead(
    readJsonIfPresent(headPath(params.tenantId, params.stateDir)),
    params.tenantId,
  );
  return parsed ?? emptyHead(params.tenantId);
}

export function listConflictEdges(params: {
  tenantId: string | null;
  stateDir: string;
}): CognitiveConflictEdge[] {
  const root = path.join(partitionRoot(params.tenantId, params.stateDir), "edges");
  if (!fs.existsSync(root)) {
    return [];
  }
  const edges: CognitiveConflictEdge[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const raw = readJsonIfPresent(path.join(root, name));
    if (raw && typeof raw === "object" && (raw as CognitiveConflictEdge).edgeId) {
      edges.push(raw as CognitiveConflictEdge);
    }
  }
  return edges;
}

export function readConflictEdge(params: {
  edgeId: string;
  tenantId: string | null;
  stateDir: string;
}): CognitiveConflictEdge | null {
  const raw = readJsonIfPresent(edgePath(params));
  if (!raw || typeof raw !== "object" || !(raw as CognitiveConflictEdge).edgeId) {
    return null;
  }
  return raw as CognitiveConflictEdge;
}

/**
 * Open edges touching any of `resourceIds`. This is the admission blocking set (§3.3):
 * every `conflictKind` blocks equally, and `resolved` / `superseded` never block.
 */
export function openConflictEdgesTouching(params: {
  resourceIds: string[];
  tenantId: string | null;
  stateDir: string;
}): CognitiveConflictEdge[] {
  const wanted = new Set(params.resourceIds);
  return listConflictEdges({ tenantId: params.tenantId, stateDir: params.stateDir }).filter(
    (edge) =>
      edge.status === "open" &&
      (wanted.has(edge.leftResourceId) || wanted.has(edge.rightResourceId)),
  );
}

export type ConflictGraphCasResult =
  | { ok: true; head: CognitiveConflictGraphHead }
  | { ok: false; conflict: "graph_version_mismatch" };

/**
 * Head CAS plus an optional edge row write, both under the partition lock so the recomputed
 * `graphHash` can never disagree with the stored edge set.
 *
 * `mutate` returns the next head (or null to abort with a version mismatch). It runs against
 * the freshly re-read head, so callers never write back a stale snapshot.
 */
export async function compareAndPutConflictGraphHead(params: {
  tenantId: string | null;
  stateDir: string;
  expectedGraphVersion: number;
  mutate: (current: CognitiveConflictGraphHead) => {
    head: CognitiveConflictGraphHead;
    edge?: CognitiveConflictEdge;
  } | null;
}): Promise<ConflictGraphCasResult> {
  const dest = headPath(params.tenantId, params.stateDir);
  let outcome: ConflictGraphCasResult | null = null;
  await withCognitiveFileLock(`${dest}.lock`, LOCK_TIMEOUT, () => {
    const current =
      parseHead(readJsonIfPresent(dest), params.tenantId) ?? emptyHead(params.tenantId);
    if (current.graphVersion !== params.expectedGraphVersion) {
      outcome = { ok: false, conflict: "graph_version_mismatch" };
      return;
    }
    const next = params.mutate(current);
    if (!next) {
      outcome = { ok: false, conflict: "graph_version_mismatch" };
      return;
    }
    // Monotonic guards: tokens and epochs are generations, never counters that can rewind.
    if (
      next.head.graphVersion <= current.graphVersion ||
      next.head.lastFencingToken < current.lastFencingToken ||
      next.head.graphEpoch < current.graphEpoch
    ) {
      throw new Error("cognitive_conflict_graph_invariant:non_monotonic_head");
    }
    if (next.edge) {
      writeJsonDurable(
        edgePath({
          edgeId: next.edge.edgeId,
          tenantId: params.tenantId,
          stateDir: params.stateDir,
        }),
        next.edge,
      );
    }
    // Recompute the hash from disk after the edge write so head and edges cannot drift.
    const openEdgeIds = listConflictEdges({
      tenantId: params.tenantId,
      stateDir: params.stateDir,
    })
      .filter((edge) => edge.status === "open")
      .map((edge) => edge.edgeId);
    const head: CognitiveConflictGraphHead = {
      ...next.head,
      graphHash: computeConflictGraphHash(openEdgeIds),
      updatedAt: new Date().toISOString(),
    };
    writeJsonDurable(dest, head);
    outcome = { ok: true, head };
  });
  if (!outcome) {
    throw new Error("cognitive_conflict_graph_cas_failed");
  }
  return outcome;
}

export function isReservationLeaseExpired(
  reservation: CognitiveMergeReservation,
  now: Date,
): boolean {
  return Date.parse(reservation.leaseExpiresAt) <= now.getTime();
}

/** Sampled at each release/renew/mark action — never a start-of-operation snapshot. */
export type GovernanceActionClock = () => Date;

export function resolveActionClock(params: {
  clock?: GovernanceActionClock;
  now?: Date;
}): GovernanceActionClock {
  if (params.clock) {
    return params.clock;
  }
  if (params.now) {
    const frozen = params.now;
    return () => frozen;
  }
  return () => new Date();
}

const HOLDER_BRAND = Symbol("openbot.mergeReservationHolder");

/**
 * Unforgeable live-holder capability. Minted only by {@link acquireMergeReservation}
 * and never persisted. Reading the graph head (mergeId + token) cannot reconstruct it.
 * Only this capability may perform S9 / holder release (B40).
 */
export type MergeReservationHolder = {
  readonly [HOLDER_BRAND]: true;
  readonly reservationId: string;
  readonly mergeId: string;
  readonly fencingToken: number;
};

export function isMergeReservationHolder(value: unknown): value is MergeReservationHolder {
  return Boolean(
    value && typeof value === "object" && (value as MergeReservationHolder)[HOLDER_BRAND],
  );
}

function mintHolder(reservation: CognitiveMergeReservation): MergeReservationHolder {
  return Object.freeze({
    [HOLDER_BRAND]: true as const,
    reservationId: reservation.reservationId,
    mergeId: reservation.mergeId,
    fencingToken: reservation.fencingToken,
  });
}

function holderMatches(
  reservation: CognitiveMergeReservation,
  holder: MergeReservationHolder,
): boolean {
  return (
    isMergeReservationHolder(holder) &&
    holder.reservationId === reservation.reservationId &&
    holder.mergeId === reservation.mergeId &&
    holder.fencingToken === reservation.fencingToken
  );
}

export type AcquireReservationResult =
  | {
      ok: true;
      head: CognitiveConflictGraphHead;
      reservation: CognitiveMergeReservation;
      holder: MergeReservationHolder;
    }
  | { ok: false; conflict: "conflict_graph_reserved" | "graph_version_mismatch" };

/**
 * S1 / R3 / R7-step-1: acquire the exclusive reservation and advance both generations.
 *
 * An existing reservation — live, expired, or mid-takeover — always fails closed. Releasing
 * someone else's reservation is only possible through the takeover path T1–T4 (B40), which
 * fences the participants first.
 */
export async function acquireMergeReservation(params: {
  tenantId: string | null;
  stateDir: string;
  mergeId: string;
  targetResourceId: string;
  sourceResourceIds: string[];
  derivedMemoryResourceId: string;
  leaseMs?: number;
  now?: Date;
  derivedCreated?: boolean;
}): Promise<AcquireReservationResult> {
  const now = params.now ?? new Date();
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  if (head.reservation) {
    return { ok: false, conflict: "conflict_graph_reserved" };
  }
  let reservation: CognitiveMergeReservation | null = null;
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      if (current.reservation) {
        return null;
      }
      const fencingToken = current.lastFencingToken + 1;
      const reservedGraphEpoch = current.graphEpoch + 1;
      reservation = {
        reservationId: `res-${params.mergeId}-${fencingToken}`,
        mergeId: params.mergeId,
        fencingToken,
        reservedGraphEpoch,
        reservedGraphVersion: current.graphVersion,
        reservedGraphHash: current.graphHash,
        targetResourceId: params.targetResourceId,
        sourceResourceIds: [...params.sourceResourceIds],
        derivedMemoryResourceId: params.derivedMemoryResourceId,
        state: "held",
        acquiredAt: now.toISOString(),
        leaseExpiresAt: new Date(
          now.getTime() + (params.leaseMs ?? MERGE_RESERVATION_LEASE_MS),
        ).toISOString(),
        derivedCreated: params.derivedCreated === true,
      };
      return {
        head: {
          ...current,
          graphVersion: current.graphVersion + 1,
          graphEpoch: reservedGraphEpoch,
          lastFencingToken: fencingToken,
          reservation,
        },
      };
    },
  });
  if (!cas.ok) {
    const latest = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
    return {
      ok: false,
      conflict: latest.reservation ? "conflict_graph_reserved" : "graph_version_mismatch",
    };
  }
  if (!reservation) {
    throw new Error("cognitive_conflict_graph_invariant:reservation_missing");
  }
  return { ok: true, head: cas.head, reservation, holder: mintHolder(reservation) };
}

/** Renewable once: a second renewal is refused so a wedged holder stays takeover-able. */
export async function renewMergeReservation(params: {
  tenantId: string | null;
  stateDir: string;
  holder: MergeReservationHolder;
  leaseMs?: number;
  now?: Date;
  clock?: GovernanceActionClock;
}): Promise<{ ok: true; head: CognitiveConflictGraphHead } | { ok: false; conflict: string }> {
  const clock = resolveActionClock(params);
  const now = clock();
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  const reservation = head.reservation;
  if (!reservation || reservation.state !== "held" || !holderMatches(reservation, params.holder)) {
    return { ok: false, conflict: "conflict_graph_reserved" };
  }
  if (isReservationLeaseExpired(reservation, now)) {
    return { ok: false, conflict: "lease_expired" };
  }
  if (reservation.renewed) {
    return { ok: false, conflict: "lease_renewal_exhausted" };
  }
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      const held = current.reservation;
      if (
        !held ||
        held.state !== "held" ||
        !holderMatches(held, params.holder) ||
        isReservationLeaseExpired(held, clock())
      ) {
        return null;
      }
      return {
        head: {
          ...current,
          graphVersion: current.graphVersion + 1,
          reservation: {
            ...held,
            renewed: true,
            leaseExpiresAt: new Date(
              clock().getTime() + (params.leaseMs ?? MERGE_RESERVATION_LEASE_MS),
            ).toISOString(),
          },
        },
      };
    },
  });
  return cas.ok ? { ok: true, head: cas.head } : { ok: false, conflict: cas.conflict };
}

export type HolderReleaseConflict =
  | "not_holder"
  | "graph_version_mismatch"
  | "fencing"
  | "lease_expired";

function holderReleaseDenied(
  reservation: CognitiveMergeReservation,
  holder: MergeReservationHolder,
  now: Date,
): Exclude<HolderReleaseConflict, "graph_version_mismatch"> | null {
  if (!holderMatches(reservation, holder)) {
    return "not_holder";
  }
  if (reservation.state === "fencing") {
    return "fencing";
  }
  if (isReservationLeaseExpired(reservation, now)) {
    return "lease_expired";
  }
  return null;
}

/**
 * S9: the live holder releases its own reservation, carrying its own token. It was never
 * fenced, so no participant bump is required. Anyone else must use T1–T4.
 * After T2 (`fencing`) or lease expiry the capability is dead — release would skip T3.
 */
export async function releaseMergeReservation(params: {
  tenantId: string | null;
  stateDir: string;
  holder: MergeReservationHolder;
  now?: Date;
  clock?: GovernanceActionClock;
}): Promise<{ ok: true } | { ok: false; conflict: HolderReleaseConflict }> {
  const clock = resolveActionClock(params);
  const now = clock();
  if (!isMergeReservationHolder(params.holder)) {
    return { ok: false, conflict: "not_holder" };
  }
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  const reservation = head.reservation;
  if (!reservation) {
    return { ok: true };
  }
  const denied = holderReleaseDenied(reservation, params.holder, now);
  if (denied) {
    return { ok: false, conflict: denied };
  }
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      const held = current.reservation;
      if (!held) {
        return { head: { ...current, graphVersion: current.graphVersion + 1 } };
      }
      if (holderReleaseDenied(held, params.holder, clock())) {
        return null;
      }
      return {
        head: { ...current, graphVersion: current.graphVersion + 1, reservation: null },
      };
    },
  });
  return cas.ok ? { ok: true } : { ok: false, conflict: "graph_version_mismatch" };
}

/** Persist S3 evidence on the live reservation. Requires the unforgeable holder. */
export async function markReservationDerivedCreated(params: {
  tenantId: string | null;
  stateDir: string;
  holder: MergeReservationHolder;
  now?: Date;
  clock?: GovernanceActionClock;
}): Promise<{ ok: true } | { ok: false; conflict: HolderReleaseConflict }> {
  const clock = resolveActionClock(params);
  if (!isMergeReservationHolder(params.holder)) {
    return { ok: false, conflict: "not_holder" };
  }
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  const reservation = head.reservation;
  if (!reservation) {
    return { ok: false, conflict: "not_holder" };
  }
  const denied = holderReleaseDenied(reservation, params.holder, clock());
  if (denied) {
    return { ok: false, conflict: denied };
  }
  if (reservation.derivedCreated) {
    return { ok: true };
  }
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      const held = current.reservation;
      if (!held || holderReleaseDenied(held, params.holder, clock())) {
        return null;
      }
      return {
        head: {
          ...current,
          graphVersion: current.graphVersion + 1,
          reservation: { ...held, derivedCreated: true },
        },
      };
    },
  });
  if (cas.ok) {
    return { ok: true };
  }
  const latest = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  if (!latest.reservation) {
    return { ok: false, conflict: "not_holder" };
  }
  const after = holderReleaseDenied(latest.reservation, params.holder, clock());
  return { ok: false, conflict: after ?? "graph_version_mismatch" };
}

/**
 * T2: flip the expired reservation to `state: "fencing"` and mint the takeover generations.
 * Edge writers stay blocked while fencing is in progress, and T4 may only run after T3 has
 * raised every recorded participant.
 */
export async function beginConflictGraphTakeover(params: {
  tenantId: string | null;
  stateDir: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      reservation: CognitiveMergeReservation;
      takeoverToken: number;
      takeoverEpoch: number;
    }
  | { ok: false; conflict: "no_reservation" | "lease_live" | "graph_version_mismatch" }
> {
  const now = params.now ?? new Date();
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  const reservation = head.reservation;
  if (!reservation) {
    return { ok: false, conflict: "no_reservation" };
  }
  // A takeover already in progress is resumable: return its recorded generations.
  if (reservation.state === "fencing") {
    return {
      ok: true,
      reservation,
      takeoverToken: reservation.takeoverToken ?? head.lastFencingToken,
      takeoverEpoch: reservation.takeoverEpoch ?? head.graphEpoch,
    };
  }
  if (!isReservationLeaseExpired(reservation, now)) {
    return { ok: false, conflict: "lease_live" };
  }
  let fencing: CognitiveMergeReservation | null = null;
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      const held = current.reservation;
      if (!held || held.state === "fencing") {
        return null;
      }
      const takeoverToken = current.lastFencingToken + 1;
      const takeoverEpoch = current.graphEpoch + 1;
      fencing = { ...held, state: "fencing", takeoverToken, takeoverEpoch };
      return {
        head: {
          ...current,
          graphVersion: current.graphVersion + 1,
          lastFencingToken: takeoverToken,
          graphEpoch: takeoverEpoch,
          reservation: fencing,
        },
      };
    },
  });
  if (!cas.ok || !fencing) {
    return { ok: false, conflict: "graph_version_mismatch" };
  }
  const settled = fencing as CognitiveMergeReservation;
  return {
    ok: true,
    reservation: settled,
    takeoverToken: settled.takeoverToken!,
    takeoverEpoch: settled.takeoverEpoch!,
  };
}

/** T4: clear the fenced reservation. Callers must have completed T3 for every participant. */
export async function completeConflictGraphTakeover(params: {
  tenantId: string | null;
  stateDir: string;
  reservationId: string;
}): Promise<{ ok: true } | { ok: false; conflict: "not_fencing" | "graph_version_mismatch" }> {
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  const reservation = head.reservation;
  if (!reservation) {
    return { ok: true };
  }
  if (reservation.state !== "fencing" || reservation.reservationId !== params.reservationId) {
    return { ok: false, conflict: "not_fencing" };
  }
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      const held = current.reservation;
      if (!held) {
        return { head: { ...current, graphVersion: current.graphVersion + 1 } };
      }
      if (held.state !== "fencing" || held.reservationId !== params.reservationId) {
        return null;
      }
      return { head: { ...current, graphVersion: current.graphVersion + 1, reservation: null } };
    },
  });
  return cas.ok ? { ok: true } : { ok: false, conflict: "graph_version_mismatch" };
}

/** Participant set a takeover must fence (T3). */
export function reservationParticipants(reservation: CognitiveMergeReservation): string[] {
  return [
    ...new Set([
      reservation.targetResourceId,
      ...reservation.sourceResourceIds,
      reservation.derivedMemoryResourceId,
    ]),
  ];
}
