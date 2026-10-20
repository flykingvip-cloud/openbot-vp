import { describe, expect, it } from "vitest";
import {
  canonicalizeActivationEpoch,
  canonicalSerialize,
  canonicalTenantId,
  deriveCandidateId,
  deriveTaskKey,
  fileKeyForTenant,
  normalizeGoal,
  sha256Hex,
} from "./canonical.js";

describe("normalizeGoal", () => {
  it("is deterministic and idempotent", () => {
    const input = "  每周   监控\t竞品  ";
    const once = normalizeGoal(input);
    expect(once).toBe("每周 监控 竞品");
    expect(normalizeGoal(once)).toBe(once);
  });

  it("folds only whitespace and does not change semantics", () => {
    expect(normalizeGoal(" 每周  监控\t竞品 ")).toBe(normalizeGoal("每周 监控 竞品"));
  });

  it("preserves negation, numbers, entities and punctuation (semantic distinction)", () => {
    expect(normalizeGoal("不要发送给全部销售")).not.toBe(normalizeGoal("发送给全部销售"));
    expect(normalizeGoal("涨幅超过 10% 预警")).not.toBe(normalizeGoal("涨幅超过 20% 预警"));
    expect(normalizeGoal("整理后发给张总")).not.toBe(normalizeGoal("整理后发给李总"));
    expect(normalizeGoal("监控华东,不含华南")).not.toBe(normalizeGoal("监控华东华南"));
  });
});

describe("canonicalSerialize", () => {
  it("is injective across field boundaries (length-prefixed frames)", () => {
    // Without length prefixes these would collide; framing keeps them distinct.
    const a = canonicalSerialize(["a", "bc"]);
    const b = canonicalSerialize(["ab", "c"]);
    expect(a.equals(b)).toBe(false);
  });

  it("is stable for the same field vector", () => {
    expect(canonicalSerialize(["x", "y"]).equals(canonicalSerialize(["x", "y"]))).toBe(true);
  });
});

describe("canonicalizeActivationEpoch", () => {
  it("has no leading zeros so 1 and 01 cannot collide", () => {
    expect(canonicalizeActivationEpoch(1)).toBe("1");
    expect(canonicalizeActivationEpoch(10)).toBe("10");
  });

  it("rejects non-integer or negative epochs", () => {
    expect(() => canonicalizeActivationEpoch(-1)).toThrow();
    expect(() => canonicalizeActivationEpoch(1.5)).toThrow();
  });
});

describe("fileKeyForTenant", () => {
  it("is a full 64-hex SHA-256, deterministic", () => {
    const key = fileKeyForTenant("tenant-a");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(fileKeyForTenant("tenant-a")).toBe(key);
  });

  it("maps different tenants to different keys", () => {
    expect(fileKeyForTenant("tenant-a")).not.toBe(fileKeyForTenant("tenant-b"));
  });

  it("is NFC-stable (same identity in NFD and NFC maps to one key)", () => {
    const nfc = "é"; // U+00E9
    const nfd = "e\u0301"; // e + combining acute
    expect(nfc).not.toBe(nfd);
    expect(fileKeyForTenant(nfc)).toBe(fileKeyForTenant(nfd));
    expect(canonicalTenantId(nfc)).toBe(canonicalTenantId(nfd));
  });
});

describe("derived ids (Scheme A: plain, non-unique)", () => {
  it("deriveCandidateId is deterministic and tuple-sensitive", () => {
    const base = {
      tenantId: "t1",
      conversationId: "c1",
      sourceMessageId: "m1",
      decisionVersion: "v1",
    };
    expect(deriveCandidateId(base)).toBe(deriveCandidateId({ ...base }));
    expect(deriveCandidateId(base)).not.toBe(deriveCandidateId({ ...base, sourceMessageId: "m2" }));
    expect(deriveCandidateId(base)).toMatch(/^cand_[0-9a-f]{64}$/);
  });

  it("deriveTaskKey is deterministic and tuple-sensitive", () => {
    const base = {
      tenantId: "t1",
      conversationId: "c1",
      normalizedGoal: normalizeGoal("每周监控竞品"),
      activationEpoch: 1,
    };
    expect(deriveTaskKey(base)).toBe(deriveTaskKey({ ...base }));
    expect(deriveTaskKey(base)).not.toBe(deriveTaskKey({ ...base, activationEpoch: 2 }));
    expect(deriveTaskKey(base)).toMatch(/^ctask_[0-9a-f]{64}$/);
  });

  it("sha256Hex matches for equal buffers/strings", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex(Buffer.from("abc", "utf8")));
  });
});
