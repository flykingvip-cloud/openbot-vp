/**
 * P1-A2 — PolicyMigrationEvent infrastructure (Floor Runtime v2.1 §4.2, §4.3 Q5,
 * §5.0 P1-A2, file table "policy-migration-event.ts").
 *
 * Scope in P1-A2:
 *   - the event type exactly as specified in §4.2;
 *   - a pure, idempotent migration driver `migrateLegacyGroupSettings(old, ctx, rules)`
 *     → { next, events, report } that bumps `operatingState.policyRevision` once per
 *     batch and emits one event per changed literal L2 value;
 *   - the Q5 step-① rule `materializeQ5DefaultsRule` (materialize_default_before_l1_change
 *     + unknown_value_normalized for the same fields), which must preserve policyHash;
 *   - the txn protocol "write txn → append events → write state" with a policyRevision CAS
 *     and roll-forward recovery (`applyPolicyMigrationPlan` / `recoverPolicyMigrationTxn`);
 *   - pure query helper `selectPolicyMigrations` (latest 50, optional field filter).
 *
 * Not in P1-A2 (declared in the reason union for later PRs): selfAdvance reset and Q3
 * coordinator_single_source (capability lane ③, P1-A5③), phantom_key_stricter_retained
 * (needs the §7.1 read-only scan). Q5 step ② (switching L1_DEFAULT to the seed values) is
 * NOT done here: it is only safe after step ① has run on every existing group, which needs
 * Owner authorisation. Nothing in this module runs on its own; no caller is wired.
 */
import { createHash } from "node:crypto";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import { POLICY_COMPILER_REVISION } from "./policy-identity.js";
import { resolveGroupEffectivePolicy } from "./resolve-effective-policy.js";

export const POLICY_MIGRATION_EVENT_KIND = "policy_migration" as const;

export type PolicyMigrationReason =
  /** botMaySelfAdvance true→false (lane ③). */
  | "self_advance_requires_low_risk_authorization"
  /** Q3: organisation coordinator written into governance (lane ③). */
  | "coordinator_single_source"
  /** Q5: before the L1_DEFAULT switch, write the old default explicitly into existing groups. */
  | "materialize_default_before_l1_change"
  /** Phantom key stricter than default retained as legacy clamp (needs §7.1 scan). */
  | "phantom_key_stricter_retained"
  /** Unknown enum / malformed value normalised to what the compiler already used. */
  | "unknown_value_normalized";

export type PolicyMigrationEvent = Readonly<{
  kind: typeof POLICY_MIGRATION_EVENT_KIND;
  eventId: string;
  at: number;
  tenantId: string | null;
  groupId: string;
  /** e.g. "collaborationPolicy.botMaySelfAdvanceWithoutHuman", "governance.coordinatorBotId". */
  field: string;
  from: unknown;
  to: unknown;
  reason: PolicyMigrationReason;
  actor: "migration";
  /** operatingState.policyRevision after the migration write. */
  policyRevision: number;
  /** Shared by every event of one migration batch. */
  migrationId: string;
  compilerRevision: string;
}>;

type OperatingState = GatewayCollaborationGroupOperatingState;

/** Field paths a migration rule may touch (operatingState literal L2 values). */
export type PolicyMigrationField =
  | `groupProfile.${Extract<keyof OperatingState["groupProfile"], string>}`
  | `governance.${Extract<keyof OperatingState["governance"], string>}`
  | `collaborationPolicy.${Extract<keyof OperatingState["collaborationPolicy"], string>}`;

export type PolicyFieldChange = Readonly<{
  field: PolicyMigrationField;
  from: unknown;
  to: unknown;
  reason: PolicyMigrationReason;
}>;

export type PolicyMigrationRule = Readonly<{
  id: string;
  /** When true the driver fails closed unless policyHash is unchanged. */
  preservesPolicyHash: boolean;
  plan: (state: OperatingState) => readonly PolicyFieldChange[];
}>;

export type PolicyMigrationContext = Readonly<{
  tenantId: string | null;
  migrationId: string;
  now: number;
}>;

export type PolicyMigrationReport = Readonly<{
  groupId: string;
  changed: boolean;
  rules: string[];
  fields: string[];
  fromPolicyRevision: number;
  toPolicyRevision: number;
  policyHashBefore: string;
  policyHashAfter: string;
}>;

export type PolicyMigrationPlan = Readonly<{
  next: OperatingState;
  events: readonly PolicyMigrationEvent[];
  report: PolicyMigrationReport;
}>;

/**
 * Q5 values that existing groups currently inherit from L1_DEFAULT
 * (policy-compiler.ts). Asserted equal to compile({}) in tests.
 */
export const Q5_LEGACY_L1_DEFAULTS = Object.freeze({
  collaborationMode: "discussion_driven",
  mentionBotMustRespond: false,
  maxVisibleBotRepliesPerRound: 5,
} as const);

/**
 * Q5 target defaults = new-group seed (collaboration-learning/shared.ts).
 * Reference only: P1-A2 does NOT switch L1_DEFAULT (§4.3 Q5 step ②).
 */
export const Q5_SEED_DEFAULTS = Object.freeze({
  collaborationMode: "task_driven",
  mentionBotMustRespond: true,
  maxVisibleBotRepliesPerRound: 3,
} as const);

/** Fields whose L1 default changes in Q5 step ②; step ① materialises exactly these. */
export const Q5_MATERIALIZED_FIELDS = [
  "groupProfile.collaborationMode",
  "collaborationPolicy.mentionBotMustRespond",
  "collaborationPolicy.maxVisibleBotRepliesPerRound",
] as const satisfies readonly PolicyMigrationField[];

const MODE_IDS = new Set(["discussion_driven", "task_driven", "review_driven"]);

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function literal(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * Q5 step ①: write the values a group currently inherits from L1_DEFAULT explicitly, so
 * the later L1_DEFAULT switch cannot change existing groups. Mirrors the compiler's
 * default-resolution rules (policy-compiler.ts resolveMode / resolveMaxVisible /
 * mentionBotMustRespond) so policyHash is preserved by construction.
 */
export const materializeQ5DefaultsRule: PolicyMigrationRule = Object.freeze({
  id: "q5_materialize_defaults",
  preservesPolicyHash: true,
  plan(state: OperatingState): PolicyFieldChange[] {
    const changes: PolicyFieldChange[] = [];
    const rawMode: unknown = state.groupProfile?.collaborationMode;
    const trimmedMode = typeof rawMode === "string" ? rawMode.trim() : "";
    if (!trimmedMode) {
      changes.push({
        field: "groupProfile.collaborationMode",
        from: literal(rawMode),
        to: Q5_LEGACY_L1_DEFAULTS.collaborationMode,
        reason: "materialize_default_before_l1_change",
      });
    } else if (!MODE_IDS.has(trimmedMode)) {
      changes.push({
        field: "groupProfile.collaborationMode",
        from: rawMode,
        to: Q5_LEGACY_L1_DEFAULTS.collaborationMode,
        reason: "unknown_value_normalized",
      });
    }
    const policy = (state.collaborationPolicy ?? {}) as Partial<
      OperatingState["collaborationPolicy"]
    >;
    const rawMention: unknown = policy.mentionBotMustRespond;
    if (absent(rawMention)) {
      changes.push({
        field: "collaborationPolicy.mentionBotMustRespond",
        from: literal(rawMention),
        to: Q5_LEGACY_L1_DEFAULTS.mentionBotMustRespond,
        reason: "materialize_default_before_l1_change",
      });
    }
    const rawMax: unknown = policy.maxVisibleBotRepliesPerRound;
    if (absent(rawMax)) {
      changes.push({
        field: "collaborationPolicy.maxVisibleBotRepliesPerRound",
        from: literal(rawMax),
        to: Q5_LEGACY_L1_DEFAULTS.maxVisibleBotRepliesPerRound,
        reason: "materialize_default_before_l1_change",
      });
    } else if (typeof rawMax !== "number" || !Number.isFinite(rawMax)) {
      changes.push({
        field: "collaborationPolicy.maxVisibleBotRepliesPerRound",
        from: rawMax,
        to: Q5_LEGACY_L1_DEFAULTS.maxVisibleBotRepliesPerRound,
        reason: "unknown_value_normalized",
      });
    }
    return changes;
  },
});

function setField(state: OperatingState, field: PolicyMigrationField, value: unknown) {
  const dot = field.indexOf(".");
  const root = field.slice(0, dot) as "groupProfile" | "governance" | "collaborationPolicy";
  const key = field.slice(dot + 1);
  const section = { ...(state[root] as Record<string, unknown> | undefined) };
  section[key] = value;
  return { ...state, [root]: section } as OperatingState;
}

export function policyMigrationEventId(params: {
  tenantId: string | null;
  groupId: string;
  field: string;
  reason: PolicyMigrationReason;
  from: unknown;
  to: unknown;
  policyRevision: number;
}): string {
  // Content-addressed (migrationId / time excluded): re-running after a crash between
  // "append events" and "write state" reproduces the same ids, so appends dedupe.
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        params.tenantId,
        params.groupId,
        params.field,
        params.reason,
        literal(params.from),
        literal(params.to),
        params.policyRevision,
      ]),
    )
    .digest("hex");
  return `pme_${digest.slice(0, 32)}`;
}

function policyHashOf(state: OperatingState): string {
  return resolveGroupEffectivePolicy({ operatingState: state }).policyHash;
}

/**
 * Pure migration driver: `migrateLegacyGroupSettings(old) → { next, events, report }` (§4.1).
 * - Every literal change yields exactly one event (§4.2 rule 1).
 * - policyRevision is bumped once per batch; all events carry the post-write revision.
 * - Idempotent: once applied, rules plan no further changes → no events, `next === old`.
 */
export function migrateLegacyGroupSettings(
  old: OperatingState,
  ctx: PolicyMigrationContext,
  rules: readonly PolicyMigrationRule[] = [materializeQ5DefaultsRule],
): PolicyMigrationPlan {
  const fromRevision = typeof old.policyRevision === "number" ? old.policyRevision : 0;
  const hashBefore = policyHashOf(old);
  let next = old;
  const changes: PolicyFieldChange[] = [];
  const appliedRules: string[] = [];
  for (const rule of rules) {
    const ruleChanges = rule.plan(next);
    if (ruleChanges.length === 0) {
      continue;
    }
    const before = policyHashOf(next);
    let candidate = next;
    for (const change of ruleChanges) {
      candidate = setField(candidate, change.field, change.to);
    }
    if (rule.preservesPolicyHash && policyHashOf(candidate) !== before) {
      throw new Error(
        `policy migration rule ${rule.id} would change policyHash for group ${old.groupId}`,
      );
    }
    next = candidate;
    changes.push(...ruleChanges);
    appliedRules.push(rule.id);
  }
  if (changes.length === 0) {
    return {
      next: old,
      events: [],
      report: {
        groupId: old.groupId,
        changed: false,
        rules: [],
        fields: [],
        fromPolicyRevision: fromRevision,
        toPolicyRevision: fromRevision,
        policyHashBefore: hashBefore,
        policyHashAfter: hashBefore,
      },
    };
  }
  const toRevision = fromRevision + 1;
  next = { ...next, policyRevision: toRevision };
  const events: PolicyMigrationEvent[] = changes.map((change) => ({
    kind: POLICY_MIGRATION_EVENT_KIND,
    eventId: policyMigrationEventId({
      tenantId: ctx.tenantId,
      groupId: old.groupId,
      field: change.field,
      reason: change.reason,
      from: change.from,
      to: change.to,
      policyRevision: toRevision,
    }),
    at: ctx.now,
    tenantId: ctx.tenantId,
    groupId: old.groupId,
    field: change.field,
    from: literal(change.from),
    to: literal(change.to),
    reason: change.reason,
    actor: "migration",
    policyRevision: toRevision,
    migrationId: ctx.migrationId,
    compilerRevision: POLICY_COMPILER_REVISION,
  }));
  return {
    next,
    events,
    report: {
      groupId: old.groupId,
      changed: true,
      rules: appliedRules,
      fields: changes.map((change) => change.field),
      fromPolicyRevision: fromRevision,
      toPolicyRevision: toRevision,
      policyHashBefore: hashBefore,
      policyHashAfter: policyHashOf(next),
    },
  };
}

// ---------------------------------------------------------------------------
// Txn: write txn → append events → write state (§4.2 rule 2), policyRevision CAS (§7.2).
// ---------------------------------------------------------------------------

export type PolicyMigrationTxn = Readonly<{
  kind: "policy_migration_txn";
  groupId: string;
  tenantId: string | null;
  migrationId: string;
  expectedPolicyRevision: number;
  next: OperatingState;
  events: readonly PolicyMigrationEvent[];
  createdAt: number;
}>;

export type PolicyMigrationTxnIo = Readonly<{
  readState: () => Promise<OperatingState | null>;
  writeState: (state: OperatingState) => Promise<void>;
  readTxn: () => Promise<PolicyMigrationTxn | null>;
  writeTxn: (txn: PolicyMigrationTxn) => Promise<void>;
  clearTxn: () => Promise<void>;
  /** Must be idempotent by eventId (re-appending an existing eventId is a no-op). */
  appendEvents: (events: readonly PolicyMigrationEvent[]) => Promise<void>;
}>;

export class PolicyMigrationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyMigrationConflictError";
  }
}

function revisionOf(state: OperatingState | null): number {
  return typeof state?.policyRevision === "number" ? state.policyRevision : 0;
}

export async function applyPolicyMigrationPlan(params: {
  plan: PolicyMigrationPlan;
  tenantId: string | null;
  migrationId: string;
  now: number;
  io: PolicyMigrationTxnIo;
}): Promise<{ status: "noop" | "applied"; policyRevision: number }> {
  const { plan, io } = params;
  if (plan.events.length === 0) {
    return { status: "noop", policyRevision: plan.report.fromPolicyRevision };
  }
  if (await io.readTxn()) {
    throw new PolicyMigrationConflictError(
      `pending policy migration txn for group ${plan.report.groupId}; recover it first`,
    );
  }
  const current = await io.readState();
  if (revisionOf(current) !== plan.report.fromPolicyRevision) {
    throw new PolicyMigrationConflictError(
      `policyRevision CAS failed for group ${plan.report.groupId}: expected ${plan.report.fromPolicyRevision}, found ${revisionOf(current)}`,
    );
  }
  await io.writeTxn({
    kind: "policy_migration_txn",
    groupId: plan.report.groupId,
    tenantId: params.tenantId,
    migrationId: params.migrationId,
    expectedPolicyRevision: plan.report.fromPolicyRevision,
    next: plan.next,
    events: plan.events,
    createdAt: params.now,
  });
  await io.appendEvents(plan.events);
  await io.writeState(plan.next);
  await io.clearTxn();
  return { status: "applied", policyRevision: plan.report.toPolicyRevision };
}

/** Roll a pending txn forward (never backward). Returns "none" when no txn is pending. */
export async function recoverPolicyMigrationTxn(
  io: PolicyMigrationTxnIo,
): Promise<{ status: "none" | "rolled_forward" }> {
  const txn = await io.readTxn();
  if (!txn) {
    return { status: "none" };
  }
  const current = await io.readState();
  const currentRevision = revisionOf(current);
  const targetRevision = revisionOf(txn.next);
  if (currentRevision === targetRevision) {
    await io.appendEvents(txn.events);
    await io.clearTxn();
    return { status: "rolled_forward" };
  }
  if (currentRevision !== txn.expectedPolicyRevision) {
    throw new PolicyMigrationConflictError(
      `policy migration txn for group ${txn.groupId} expects revision ${txn.expectedPolicyRevision}, found ${currentRevision}; manual review required`,
    );
  }
  await io.appendEvents(txn.events);
  await io.writeState(txn.next);
  await io.clearTxn();
  return { status: "rolled_forward" };
}

// ---------------------------------------------------------------------------
// Query (§4.2 rule 3): latest 50 by default, optional field filter.
// ---------------------------------------------------------------------------

export const POLICY_MIGRATIONS_DEFAULT_LIMIT = 50;

export function selectPolicyMigrations<T extends PolicyMigrationEvent>(
  events: readonly T[],
  opts?: { field?: string | null; limit?: number | null },
): T[] {
  const field = opts?.field?.trim() || null;
  const limit = Math.max(1, Math.min(opts?.limit ?? POLICY_MIGRATIONS_DEFAULT_LIMIT, 1000));
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const event of events) {
    if (event.kind !== POLICY_MIGRATION_EVENT_KIND || seen.has(event.eventId)) {
      continue;
    }
    if (field && event.field !== field) {
      continue;
    }
    seen.add(event.eventId);
    unique.push(event);
  }
  return unique
    .toSorted((left, right) => right.at - left.at || right.policyRevision - left.policyRevision)
    .slice(0, limit);
}
