import { afterEach, describe, expect, it } from "vitest";
import { resolveStewardAction } from "./daibai-action-catalog.js";
import {
  __clearConfirmationsForTest,
  computePayloadHash,
  consumeConfirmation,
  createConfirmation,
} from "./steward-confirmation-store.js";

afterEach(() => __clearConfirmationsForTest());

const payload = { agentId: "main", skillId: "s1", enabled: true };

describe("steward confirmation store", () => {
  it("issues a ticket and consumes it once (happy path)", () => {
    const env = createConfirmation({ actionId: "robot-skills.toggle", payload });
    expect(env.proposalId).toMatch(/^dbc_/);
    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "robot-skills.toggle",
      payload,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects replay (single consume / idempotency)", () => {
    const env = createConfirmation({ actionId: "robot-skills.toggle", payload });
    consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "robot-skills.toggle",
      payload,
    });
    const second = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "robot-skills.toggle",
      payload,
    });
    expect(second).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects expired tickets", () => {
    const env = createConfirmation({ actionId: "a", payload, ttlMs: 1, now: 1000 });
    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "a",
      payload,
      now: 5000,
    });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects token mismatch", () => {
    const env = createConfirmation({ actionId: "a", payload });
    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: "wrong-token",
      actionId: "a",
      payload,
    });
    expect(res).toEqual({ ok: false, reason: "token_mismatch" });
  });

  it("rejects payload tampering", () => {
    const env = createConfirmation({ actionId: "a", payload });
    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "a",
      payload: { ...payload, enabled: false }, // tampered
    });
    expect(res).toEqual({ ok: false, reason: "payload_mismatch" });
  });

  it("rejects action mismatch", () => {
    const env = createConfirmation({ actionId: "a", payload });
    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "b",
      payload,
    });
    expect(res).toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("payload hash is key-order independent", () => {
    expect(computePayloadHash({ a: 1, b: 2 })).toBe(computePayloadHash({ b: 2, a: 1 }));
  });
});

describe("payload hash covers nested values", () => {
  // Regression. The previous implementation passed `Object.keys(payload).toSorted()`
  // as JSON.stringify's second argument, which is a *replacer*: an array replacer is
  // a recursive property-name allowlist, not a sort order. Nested keys were almost
  // never in that allowlist, so every nested object hashed as `{}` and its contents
  // were simply not bound by the ticket. Each assertion below collided before.

  it("binds a nested field, so it cannot change after approval", () => {
    const approved = { actionId: "collab.dispatch", timeWindow: { startMs: 1_000, endMs: 2_000 } };
    const tampered = {
      actionId: "collab.dispatch",
      timeWindow: { startMs: 1_000, endMs: 99_999_999 },
    };
    expect(computePayloadHash(tampered)).not.toBe(computePayloadHash(approved));
  });

  it("rejects consumption when only a nested field was tampered with", () => {
    // The end-to-end consequence: an approval-binding bypass, not just a hash quirk.
    const approved = { actionId: "collab.dispatch", timeWindow: { startMs: 1_000, endMs: 2_000 } };
    const env = createConfirmation({ actionId: "collab.dispatch", payload: approved });
    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "collab.dispatch",
      payload: { actionId: "collab.dispatch", timeWindow: { startMs: 1_000, endMs: 99_999_999 } },
    });
    expect(res).toEqual({ ok: false, reason: "payload_mismatch" });
  });

  it("binds values inside arrays", () => {
    expect(computePayloadHash({ targets: [{ id: "a" }] })).not.toBe(
      computePayloadHash({ targets: [{ id: "b" }] }),
    );
  });

  it("binds deeply nested fields", () => {
    expect(computePayloadHash({ a: { b: { c: 1 } } })).not.toBe(
      computePayloadHash({ a: { b: { c: 2 } } }),
    );
  });

  it("stays key-order independent at every depth", () => {
    expect(computePayloadHash({ outer: { a: 1, b: 2 } })).toBe(
      computePayloadHash({ outer: { b: 2, a: 1 } }),
    );
  });

  it("distinguishes a nested object from an absent one", () => {
    expect(computePayloadHash({ a: 1, nested: {} })).not.toBe(computePayloadHash({ a: 1 }));
  });
});

describe("payload hash follows JSON semantics", () => {
  // stableStringify on its own ignores toJSON and writes undefined as null. For
  // top-level fields both are regressions against the JSON.stringify call this
  // replaced, so the hash goes through a JSON round trip first.

  it("binds a Date by its value instead of collapsing it to {}", () => {
    expect(computePayloadHash({ at: new Date(0) })).not.toBe(
      computePayloadHash({ at: new Date(1) }),
    );
  });

  it("treats an undefined field as absent, and keeps it distinct from null", () => {
    expect(computePayloadHash({ a: 1, b: undefined })).toBe(computePayloadHash({ a: 1 }));
    expect(computePayloadHash({ a: 1, b: undefined })).not.toBe(
      computePayloadHash({ a: 1, b: null }),
    );
  });

  it("binds a nested Date by its value", () => {
    expect(computePayloadHash({ window: { at: new Date(0) } })).not.toBe(
      computePayloadHash({ window: { at: new Date(1) } }),
    );
  });

  it("hashes the Number.NaN sentinel without throwing", () => {
    // schedule.entry.add's builder uses Number.NaN for a missing startAtMs, so issuing
    // a ticket must accept non-finite numbers.
    expect(() => computePayloadHash({ startAtMs: Number.NaN })).not.toThrow();
  });
});

describe("payload hash keeps an omitted field distinct from a non-finite one", () => {
  // Reachable on main before this fix. The gateway parses frames with JSON.parse, so a
  // client that sends the literal 1e999 gets Infinity, and stableStringify alone wrote
  // both Infinity and undefined as "null". The budget.set builder passes any number
  // through, so an omitted alertThreshold could become Infinity after confirmation.

  it("keeps undefined distinct from +Infinity and -Infinity", () => {
    const omitted = computePayloadHash({ a: 1, b: undefined });
    expect(computePayloadHash({ a: 1, b: Number.POSITIVE_INFINITY })).not.toBe(omitted);
    expect(computePayloadHash({ a: 1, b: Number.NEGATIVE_INFINITY })).not.toBe(omitted);
  });

  it("rejects a budget.set execution that adds alertThreshold: 1e999 after confirmation", () => {
    const action = resolveStewardAction("budget.set");
    if (!action) {
      throw new Error("budget.set is not registered in the steward action catalog");
    }
    expect(action.requiresUserConfirmation).toBe(true);
    const build = (payload: Record<string, unknown>) =>
      action.buildParams({ userId: "u1", tenantId: "t1", payload });

    const env = createConfirmation({
      actionId: "budget.set",
      payload: build({ monthlyLimitCents: 5000 }),
    });
    // Exactly what the frame parser produces for this wire text.
    const tampered = JSON.parse('{"monthlyLimitCents":5000,"alertThreshold":1e999}') as Record<
      string,
      unknown
    >;
    expect(tampered.alertThreshold).toBe(Number.POSITIVE_INFINITY);

    const res = consumeConfirmation({
      proposalId: env.proposalId,
      confirmationToken: env.confirmationToken,
      actionId: "budget.set",
      payload: build(tampered),
    });
    expect(res).toEqual({ ok: false, reason: "payload_mismatch" });
  });
});
