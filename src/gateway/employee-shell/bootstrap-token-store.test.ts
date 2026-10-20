import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_TOKEN_MAX_TTL_MS,
  createBootstrapTokenStore,
  type BootstrapTokenPrincipal,
} from "./bootstrap-token-store.js";

const principal: BootstrapTokenPrincipal = {
  userId: "user-1",
  userEmail: "employee@example.com",
  membershipId: "membership-1",
  enterpriseId: "enterprise-1",
  target: "/embed/employee/overview",
};

describe("bootstrap token store", () => {
  it("mints a token that consumes back to the bound principal", () => {
    const store = createBootstrapTokenStore();
    const token = store.mint({ ...principal, now: 0 });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    const consumed = store.consume(token, 1_000);
    expect(consumed).toEqual(principal);
  });

  it("is single-use: a second consume returns null", () => {
    const store = createBootstrapTokenStore();
    const token = store.mint({ ...principal, now: 0 });
    expect(store.consume(token, 1)).not.toBeNull();
    expect(store.consume(token, 2)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("rejects an expired token (and removes it, preventing replay)", () => {
    const store = createBootstrapTokenStore();
    const token = store.mint({ ...principal, now: 0, ttlMs: 1_000 });
    expect(store.consume(token, 2_000)).toBeNull();
    // Even before the TTL, a consumed-because-expired token cannot be reused.
    expect(store.consume(token, 500)).toBeNull();
  });

  it("clamps the TTL to the <= 60s maximum", () => {
    const store = createBootstrapTokenStore();
    const token = store.mint({ ...principal, now: 0, ttlMs: 10 * 60_000 });
    // Just past the max TTL -> expired.
    expect(store.consume(token, BOOTSTRAP_TOKEN_MAX_TTL_MS + 1)).toBeNull();
  });

  it("uses the default TTL when none/invalid is supplied", () => {
    const store = createBootstrapTokenStore();
    const token = store.mint({ ...principal, now: 0, ttlMs: -5 });
    expect(store.consume(token, BOOTSTRAP_TOKEN_MAX_TTL_MS - 1)).not.toBeNull();
  });

  it("returns null for unknown/empty tokens", () => {
    const store = createBootstrapTokenStore();
    expect(store.consume("does-not-exist")).toBeNull();
    expect(store.consume("")).toBeNull();
  });

  it("mints distinct tokens per call", () => {
    const store = createBootstrapTokenStore();
    const a = store.mint({ ...principal, now: 0 });
    const b = store.mint({ ...principal, now: 0 });
    expect(a).not.toBe(b);
    expect(store.size()).toBe(2);
  });

  it("prunes expired records", () => {
    const store = createBootstrapTokenStore();
    store.mint({ ...principal, now: 0, ttlMs: 1_000 });
    store.mint({ ...principal, now: 0, ttlMs: 1_000 });
    expect(store.size()).toBe(2);
    store.prune(5_000);
    expect(store.size()).toBe(0);
  });
});
