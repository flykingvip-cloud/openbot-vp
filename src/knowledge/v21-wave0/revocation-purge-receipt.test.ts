import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  COGNIWEAVE_CHANNEL_4,
  REVOCATION_PURGE_CHANNELS,
  REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT,
  computeRevocationPurgeReceiptHash,
  createRevocationPurgeReceiptValidator,
  type ChannelReceipt,
  type RevocationPurgeReceipt,
} from "./revocation-purge-receipt.js";

function channel(
  name: (typeof REVOCATION_PURGE_CHANNELS)[number],
  status: ChannelReceipt["status"],
): ChannelReceipt {
  return {
    channel: name,
    status,
    hash_algorithm: "sha256",
    receipt_hash: createHash("sha256").update(`${name}:${status}`, "utf8").digest("hex"),
  };
}

function receipt(overrides: Partial<RevocationPurgeReceipt> = {}): RevocationPurgeReceipt {
  const channels =
    overrides.channels ?? REVOCATION_PURGE_CHANNELS.map((name) => channel(name, "success"));
  const purged = overrides.purged ?? channels.every((item) => item.status === "success");
  const body = {
    task_id: "syn_task_1",
    tenant_id: "syn_org",
    subject_id: "syn_subject_1",
    policy_generation: 3,
    channels,
    purged,
    hash_algorithm: "sha256" as const,
    ...overrides,
    receipt_hash: "0".repeat(64),
  };
  const { receipt_hash: _ignored, ...rest } = body;
  void _ignored;
  return { ...rest, receipt_hash: computeRevocationPurgeReceiptHash(rest) };
}

describe("CogniWeave channel-4 RevocationPurgeReceipt contract", () => {
  it("is default-off and does not accept a well-formed receipt until enabled", () => {
    expect(REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT).toBe(false);
    expect(COGNIWEAVE_CHANNEL_4).toBe("agent_history_cogniweave");
    expect([...REVOCATION_PURGE_CHANNELS]).toEqual([
      "primary_storage_acl",
      "vector_fts_index",
      "cache_materialized_snapshot",
      "agent_history_cogniweave",
    ]);
    const validator = createRevocationPurgeReceiptValidator();
    expect(validator.enabled).toBe(false);
    expect(validator.check(receipt())).toEqual({ ok: false, reason: "VALIDATOR_DISABLED" });
  });

  it("when enabled, accepts a four-channel receipt only when CogniWeave channel-4 succeeded and the hash matches", () => {
    const validator = createRevocationPurgeReceiptValidator({ enabled: true });
    const ok = validator.check(receipt());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.receipt.purged).toBe(true);
      expect(ok.receipt.channels[3]?.channel).toBe(COGNIWEAVE_CHANNEL_4);
      expect(ok.receipt.channels[3]?.status).toBe("success");
    }
  });

  it("fails closed if channel-4 is missing, failed, or purged is claimed without all four successes", () => {
    const validator = createRevocationPurgeReceiptValidator({ enabled: true });
    const withoutChannel4 = receipt({
      channels: [
        channel("primary_storage_acl", "success"),
        channel("vector_fts_index", "success"),
        channel("cache_materialized_snapshot", "success"),
        channel("primary_storage_acl", "success"),
      ],
      purged: false,
    });
    expect(validator.check(withoutChannel4).ok).toBe(false);

    const failedChannel4 = receipt({
      channels: [
        channel("primary_storage_acl", "success"),
        channel("vector_fts_index", "success"),
        channel("cache_materialized_snapshot", "success"),
        channel(COGNIWEAVE_CHANNEL_4, "failed"),
      ],
      purged: true,
    });
    expect(validator.check(failedChannel4)).toEqual({
      ok: false,
      reason: "PURGE_INVARIANT_VIOLATION",
    });

    const honestFailure = receipt({
      channels: [
        channel("primary_storage_acl", "success"),
        channel("vector_fts_index", "success"),
        channel("cache_materialized_snapshot", "success"),
        channel(COGNIWEAVE_CHANNEL_4, "failed"),
      ],
      purged: false,
    });
    expect(validator.check(honestFailure).ok).toBe(true);
  });

  it("fails closed on a tampered receipt_hash", () => {
    const validator = createRevocationPurgeReceiptValidator({ enabled: true });
    const valid = receipt();
    expect(validator.check({ ...valid, receipt_hash: "a".repeat(64) })).toEqual({
      ok: false,
      reason: "RECEIPT_HASH_MISMATCH",
    });
  });
});
