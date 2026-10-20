/**
 * P1-A2 — PolicyMigrationEvent + Q5 step-① materialisation (Floor Runtime v2.1 §4.2 / §4.3).
 */
import { describe, expect, it } from "vitest";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning.js";
import { makeOperatingState, operatingStateMatrix } from "./__fixtures__/policy-source-matrix.js";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";
import { POLICY_COMPILER_REVISION } from "./policy-identity.js";
import {
  PolicyMigrationConflictError,
  Q5_LEGACY_L1_DEFAULTS,
  Q5_MATERIALIZED_FIELDS,
  applyPolicyMigrationPlan,
  materializeQ5DefaultsRule,
  migrateLegacyGroupSettings,
  policyMigrationEventId,
  recoverPolicyMigrationTxn,
  selectPolicyMigrations,
  type PolicyMigrationEvent,
  type PolicyMigrationRule,
  type PolicyMigrationTxn,
  type PolicyMigrationTxnIo,
} from "./policy-migration-event.js";
import {
  compileGroupEffectivePolicy,
  resolveGroupEffectivePolicy,
} from "./resolve-effective-policy.js";

type State = GatewayCollaborationGroupOperatingState;

const CTX = { tenantId: "tenant-001", migrationId: "mig-q5-001", now: 1_700_000_000_000 };

const EVENT_KEYS = [
  "actor",
  "at",
  "compilerRevision",
  "eventId",
  "field",
  "from",
  "groupId",
  "kind",
  "migrationId",
  "policyRevision",
  "reason",
  "tenantId",
  "to",
].toSorted();

function expectCompleteEvent(event: PolicyMigrationEvent, state: State) {
  expect(Object.keys(event).toSorted()).toEqual(EVENT_KEYS);
  expect(event.kind).toBe("policy_migration");
  expect(event.actor).toBe("migration");
  expect(event.groupId).toBe(state.groupId);
  expect(event.tenantId).toBe(CTX.tenantId);
  expect(event.migrationId).toBe(CTX.migrationId);
  expect(event.at).toBe(CTX.now);
  expect(event.compilerRevision).toBe(POLICY_COMPILER_REVISION);
  expect(event.eventId).toMatch(/^pme_[0-9a-f]{32}$/);
  expect(event.from === undefined).toBe(false);
}

describe("Q5 constants", () => {
  it("Q5_LEGACY_L1_DEFAULTS equal what the compiler uses today for an empty group", () => {
    const empty = compileEffectiveCollaborationPolicy({});
    expect(empty.provenance.collaborationMode).toMatchObject({
      value: Q5_LEGACY_L1_DEFAULTS.collaborationMode,
      source: "l1-default",
    });
    expect(empty.provenance.mentionBotMustRespond).toMatchObject({
      value: Q5_LEGACY_L1_DEFAULTS.mentionBotMustRespond,
      source: "l1-default",
    });
    expect(empty.provenance.maxVisibleBotRepliesPerRound).toMatchObject({
      value: Q5_LEGACY_L1_DEFAULTS.maxVisibleBotRepliesPerRound,
      source: "l1-default",
    });
  });
});

describe("Q5 materialize rule — one case per rule branch", () => {
  const cases: Array<{
    name: string;
    state: State;
    field: string;
    from: unknown;
    to: unknown;
    reason: PolicyMigrationEvent["reason"];
  }> = [
    {
      name: "missing collaborationMode",
      state: makeOperatingState({
        policy: { mentionBotMustRespond: true, maxVisibleBotRepliesPerRound: 3 },
      }),
      field: "groupProfile.collaborationMode",
      from: null,
      to: "discussion_driven",
      reason: "materialize_default_before_l1_change",
    },
    {
      name: "blank collaborationMode",
      state: makeOperatingState({
        collaborationMode: "  ",
        policy: { mentionBotMustRespond: true, maxVisibleBotRepliesPerRound: 3 },
      }),
      field: "groupProfile.collaborationMode",
      from: "  ",
      to: "discussion_driven",
      reason: "materialize_default_before_l1_change",
    },
    {
      name: "unknown collaborationMode",
      state: makeOperatingState({
        collaborationMode: "freeform",
        policy: { mentionBotMustRespond: true, maxVisibleBotRepliesPerRound: 3 },
      }),
      field: "groupProfile.collaborationMode",
      from: "freeform",
      to: "discussion_driven",
      reason: "unknown_value_normalized",
    },
    {
      name: "missing mentionBotMustRespond",
      state: makeOperatingState({
        collaborationMode: "task_driven",
        policy: { maxVisibleBotRepliesPerRound: 3 },
      }),
      field: "collaborationPolicy.mentionBotMustRespond",
      from: null,
      to: false,
      reason: "materialize_default_before_l1_change",
    },
    {
      name: "missing maxVisibleBotRepliesPerRound",
      state: makeOperatingState({
        collaborationMode: "task_driven",
        policy: { mentionBotMustRespond: false },
      }),
      field: "collaborationPolicy.maxVisibleBotRepliesPerRound",
      from: null,
      to: 5,
      reason: "materialize_default_before_l1_change",
    },
    {
      name: "malformed maxVisibleBotRepliesPerRound",
      state: makeOperatingState({
        collaborationMode: "task_driven",
        policy: { mentionBotMustRespond: false, maxVisibleBotRepliesPerRound: "3" },
      }),
      field: "collaborationPolicy.maxVisibleBotRepliesPerRound",
      from: "3",
      to: 5,
      reason: "unknown_value_normalized",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const plan = migrateLegacyGroupSettings(testCase.state, CTX);
      expect(plan.events).toHaveLength(1);
      const [event] = plan.events;
      expectCompleteEvent(event, testCase.state);
      expect(event).toMatchObject({
        field: testCase.field,
        from: testCase.from,
        to: testCase.to,
        reason: testCase.reason,
        policyRevision: 1,
      });
      expect(plan.next.policyRevision).toBe(1);
      expect(plan.report).toMatchObject({
        changed: true,
        fromPolicyRevision: 0,
        toPolicyRevision: 1,
        rules: ["q5_materialize_defaults"],
        fields: [testCase.field],
      });
      expect(plan.report.policyHashAfter).toBe(plan.report.policyHashBefore);
      // The input object is never mutated.
      expect(testCase.state.policyRevision).toBeUndefined();
    });
  }

  it("a group with every Q5 field explicit and valid produces no event and no revision bump", () => {
    const state = makeOperatingState({
      collaborationMode: "task_driven",
      policy: { mentionBotMustRespond: true, maxVisibleBotRepliesPerRound: 3 },
      policyRevision: 2,
    });
    const plan = migrateLegacyGroupSettings(state, CTX);
    expect(plan.events).toEqual([]);
    expect(plan.next).toBe(state);
    expect(plan.report.toPolicyRevision).toBe(2);
  });
});

describe("Q5 property tests over the operating-state matrix", () => {
  const matrix = operatingStateMatrix();

  it(`policyHash is unchanged by step ① for every state (${matrix.length})`, () => {
    for (const state of matrix) {
      const plan = migrateLegacyGroupSettings(state, CTX);
      expect(resolveGroupEffectivePolicy({ operatingState: plan.next }).policyHash).toBe(
        resolveGroupEffectivePolicy({ operatingState: state }).policyHash,
      );
      expect(plan.report.policyHashAfter).toBe(plan.report.policyHashBefore);
    }
  });

  it("after step ① no Q5 field resolves from l1-default ⇒ the step-② L1_DEFAULT switch cannot change existing groups", () => {
    for (const state of matrix) {
      const { next } = migrateLegacyGroupSettings(state, CTX);
      const effective = compileGroupEffectivePolicy({ operatingState: next });
      expect(effective.provenance.collaborationMode.source).not.toBe("l1-default");
      expect(effective.provenance.mentionBotMustRespond.source).not.toBe("l1-default");
      expect(effective.provenance.maxVisibleBotRepliesPerRound.source).not.toBe("l1-default");
    }
  });

  it("every literal change has exactly one event; policyRevision is monotonic; rerun is idempotent", () => {
    for (const [index, base] of matrix.entries()) {
      const state = index % 2 === 0 ? base : { ...base, policyRevision: 7 };
      const plan = migrateLegacyGroupSettings(state, CTX);
      const before = state.policyRevision ?? 0;
      const changedFields = Q5_MATERIALIZED_FIELDS.filter((field) => {
        const [root, key] = field.split(".") as [keyof State, string];
        return (
          JSON.stringify((state[root] as Record<string, unknown>)?.[key]) !==
          JSON.stringify((plan.next[root] as Record<string, unknown>)?.[key])
        );
      });
      expect(plan.events.map((event) => event.field).toSorted()).toEqual(
        [...changedFields].toSorted(),
      );
      if (plan.events.length > 0) {
        expect(plan.next.policyRevision).toBe(before + 1);
        for (const event of plan.events) {
          expect(event.policyRevision).toBe(before + 1);
        }
      } else {
        expect(plan.next).toBe(state);
      }
      const rerun = migrateLegacyGroupSettings(plan.next, { ...CTX, migrationId: "mig-q5-002" });
      expect(rerun.events).toEqual([]);
      expect(rerun.next).toBe(plan.next);
    }
  });
});

describe("migration driver safety", () => {
  it("eventId is content-addressed (independent of migrationId / time)", () => {
    const state = makeOperatingState({ policy: {} });
    const a = migrateLegacyGroupSettings(state, CTX);
    const b = migrateLegacyGroupSettings(state, { ...CTX, migrationId: "other", now: 5 });
    expect(a.events.map((e) => e.eventId)).toEqual(b.events.map((e) => e.eventId));
    expect(new Set(a.events.map((e) => e.eventId)).size).toBe(a.events.length);
    expect(a.events[0].eventId).toBe(
      policyMigrationEventId({
        tenantId: CTX.tenantId,
        groupId: state.groupId,
        field: a.events[0].field,
        reason: a.events[0].reason,
        from: a.events[0].from,
        to: a.events[0].to,
        policyRevision: 1,
      }),
    );
  });

  it("fails closed when a hash-preserving rule would change policyHash", () => {
    const loosening: PolicyMigrationRule = {
      id: "bad_rule",
      preservesPolicyHash: true,
      plan: () => [
        {
          field: "collaborationPolicy.maxVisibleBotRepliesPerRound",
          from: 3,
          to: 9,
          reason: "unknown_value_normalized",
        },
      ],
    };
    expect(() =>
      migrateLegacyGroupSettings(makeOperatingState(), CTX, [materializeQ5DefaultsRule, loosening]),
    ).toThrow(/would change policyHash/);
  });
});

function memoryIo(initial: State | null) {
  const ops: string[] = [];
  const store = {
    state: initial,
    txn: null as PolicyMigrationTxn | null,
    events: [] as PolicyMigrationEvent[],
  };
  const failAt = { op: null as string | null };
  const guard = (op: string) => {
    ops.push(op);
    if (failAt.op === op) {
      failAt.op = null;
      throw new Error(`crash at ${op}`);
    }
  };
  const io: PolicyMigrationTxnIo = {
    readState: async () => store.state,
    writeState: async (state) => {
      guard("writeState");
      store.state = state;
    },
    readTxn: async () => store.txn,
    writeTxn: async (txn) => {
      guard("writeTxn");
      store.txn = txn;
    },
    clearTxn: async () => {
      guard("clearTxn");
      store.txn = null;
    },
    appendEvents: async (events) => {
      guard("appendEvents");
      const ids = new Set(store.events.map((e) => e.eventId));
      for (const event of events) {
        if (!ids.has(event.eventId)) {
          store.events.push(event);
          ids.add(event.eventId);
        }
      }
    },
  };
  return { io, ops, store, failAt };
}

describe("migration txn: write txn → append events → write state (CAS on policyRevision)", () => {
  const base = makeOperatingState({ policy: {} });

  it("applies in the specified order and records the post-write revision", async () => {
    const { io, ops, store } = memoryIo(base);
    const plan = migrateLegacyGroupSettings(base, CTX);
    const result = await applyPolicyMigrationPlan({ plan, ...CTX, io });
    expect(result).toEqual({ status: "applied", policyRevision: 1 });
    expect(ops).toEqual(["writeTxn", "appendEvents", "writeState", "clearTxn"]);
    expect(store.state?.policyRevision).toBe(1);
    expect(store.events).toHaveLength(3);
    expect(store.txn).toBeNull();
    // Rerun → noop, no duplicate events.
    const again = migrateLegacyGroupSettings(store.state!, CTX);
    expect(await applyPolicyMigrationPlan({ plan: again, ...CTX, io })).toEqual({
      status: "noop",
      policyRevision: 1,
    });
    expect(store.events).toHaveLength(3);
  });

  it("CAS: a concurrent settings write (revision moved) aborts before any write", async () => {
    const { io, ops, store } = memoryIo(base);
    const plan = migrateLegacyGroupSettings(base, CTX);
    store.state = { ...base, policyRevision: 1 };
    await expect(applyPolicyMigrationPlan({ plan, ...CTX, io })).rejects.toBeInstanceOf(
      PolicyMigrationConflictError,
    );
    expect(ops).toEqual([]);
    expect(store.events).toEqual([]);
  });

  it("crash after appending events: recovery writes state once, events are not duplicated", async () => {
    const { io, store, failAt } = memoryIo(base);
    const plan = migrateLegacyGroupSettings(base, CTX);
    failAt.op = "writeState";
    await expect(applyPolicyMigrationPlan({ plan, ...CTX, io })).rejects.toThrow(/crash/);
    expect(store.txn).not.toBeNull();
    expect(store.events).toHaveLength(3);
    expect(store.state?.policyRevision).toBeUndefined();
    // A new attempt is blocked until the pending txn is recovered.
    await expect(applyPolicyMigrationPlan({ plan, ...CTX, io })).rejects.toThrow(/pending/);
    expect(await recoverPolicyMigrationTxn(io)).toEqual({ status: "rolled_forward" });
    expect(store.state?.policyRevision).toBe(1);
    expect(store.events).toHaveLength(3);
    expect(store.txn).toBeNull();
    expect(await recoverPolicyMigrationTxn(io)).toEqual({ status: "none" });
  });

  it("crash after writing state: recovery only clears the txn", async () => {
    const { io, store, failAt } = memoryIo(base);
    const plan = migrateLegacyGroupSettings(base, CTX);
    failAt.op = "clearTxn";
    await expect(applyPolicyMigrationPlan({ plan, ...CTX, io })).rejects.toThrow(/crash/);
    expect(store.state?.policyRevision).toBe(1);
    expect(await recoverPolicyMigrationTxn(io)).toEqual({ status: "rolled_forward" });
    expect(store.events).toHaveLength(3);
    expect(store.txn).toBeNull();
  });

  it("recovery refuses to roll forward over an unexpected revision", async () => {
    const { io, store, failAt } = memoryIo(base);
    const plan = migrateLegacyGroupSettings(base, CTX);
    failAt.op = "appendEvents";
    await expect(applyPolicyMigrationPlan({ plan, ...CTX, io })).rejects.toThrow(/crash/);
    store.state = { ...base, policyRevision: 4 };
    await expect(recoverPolicyMigrationTxn(io)).rejects.toBeInstanceOf(
      PolicyMigrationConflictError,
    );
    expect(store.txn).not.toBeNull();
  });
});

describe("selectPolicyMigrations (query: latest 50, field filter)", () => {
  function event(i: number, field: string): PolicyMigrationEvent {
    return {
      kind: "policy_migration",
      eventId: `pme_${String(i).padStart(32, "0")}`,
      at: 1000 + i,
      tenantId: null,
      groupId: "g",
      field,
      from: null,
      to: i,
      reason: "materialize_default_before_l1_change",
      actor: "migration",
      policyRevision: i,
      migrationId: "m",
      compilerRevision: POLICY_COMPILER_REVISION,
    };
  }

  it("returns newest first, defaults to 50, filters by field and dedupes by eventId", () => {
    const events = Array.from({ length: 80 }, (_, i) =>
      event(
        i,
        i % 2 === 0
          ? "collaborationPolicy.mentionBotMustRespond"
          : "groupProfile.collaborationMode",
      ),
    );
    const latest = selectPolicyMigrations([...events, events[79]]);
    expect(latest).toHaveLength(50);
    expect(latest[0].at).toBe(1079);
    const filtered = selectPolicyMigrations(events, {
      field: "groupProfile.collaborationMode",
      limit: 5,
    });
    expect(filtered.map((e) => e.policyRevision)).toEqual([79, 77, 75, 73, 71]);
  });
});
