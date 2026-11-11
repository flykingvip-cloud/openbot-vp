import { describe, expect, it } from "vitest";
import { isolationProfile } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import { hashLeaseToken, isLeaseTokenFormat, mintLease, validateLease } from "./lease.js";

const config = isolationProfile();

describe("exec protocol lease", () => {
  it("mints exec1_ + 64 lowercase hex tokens and stores only the hash", () => {
    const minted = mintLease({
      subject: "a-prime",
      nowMs: 1_000_000,
      ttlMs: config.leaseTtlMs,
      tenantId: "t1",
    });
    expect(isLeaseTokenFormat(minted.token)).toBe(true);
    expect(minted.token.startsWith("exec1_")).toBe(true);
    expect(minted.record.hash).toBe(hashLeaseToken(minted.token));
    expect(minted.record.hash).not.toBe(minted.token);
    expect(minted.record.expMs).toBe(1_000_000 + config.leaseTtlMs);
  });

  it("rejects missing, malformed, or unknown tokens as EXEC_UNAUTHORIZED", () => {
    const minted = mintLease({ subject: "a-prime", nowMs: 1_000, ttlMs: config.leaseTtlMs });
    expect(() =>
      validateLease({ token: undefined, record: minted.record, nowMs: 1_000, config }),
    ).toThrowError(ExecProtocolError);
    try {
      validateLease({ token: "not-a-lease", record: minted.record, nowMs: 1_000, config });
    } catch (error) {
      expect((error as ExecProtocolError).code).toBe("EXEC_UNAUTHORIZED");
    }
    try {
      validateLease({ token: minted.token, record: undefined, nowMs: 1_000, config });
    } catch (error) {
      expect((error as ExecProtocolError).code).toBe("EXEC_UNAUTHORIZED");
    }
  });

  it("treats expired or skewed leases as EXEC_UNAUTHORIZED without a new error code", () => {
    const minted = mintLease({ subject: "a-prime", nowMs: 10_000, ttlMs: 1_000 });
    expect(() =>
      validateLease({
        token: minted.token,
        record: minted.record,
        nowMs: minted.record.expMs + config.maxClockSkewMs + 1,
        config,
      }),
    ).toThrow(/expired or skewed/);
    expect(() =>
      validateLease({
        token: minted.token,
        record: minted.record,
        nowMs: minted.record.iatMs - config.maxClockSkewMs - 1,
        config,
      }),
    ).toThrow(/expired or skewed/);
  });

  it("accepts a lease within the signed clock skew window", () => {
    const minted = mintLease({ subject: "a-prime", nowMs: 10_000, ttlMs: 1_000 });
    const record = validateLease({
      token: minted.token,
      record: minted.record,
      nowMs: minted.record.expMs + config.maxClockSkewMs,
      config,
    });
    expect(record.subject).toBe("a-prime");
  });
});
