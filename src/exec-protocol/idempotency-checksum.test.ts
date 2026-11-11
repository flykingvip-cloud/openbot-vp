import { describe, expect, it } from "vitest";
import { assertChecksumMatch, normalizeSha256, sha256Of } from "./checksum.js";
import { isolationProfile } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import { assertIdempotencyKey, canonicalizeIntent } from "./idempotency.js";
import { inlineJsonInput, uniqueIdempotencyKey } from "./test-helpers.js";

const config = isolationProfile();

describe("idempotency key rules", () => {
  it("accepts the signed charset and length bounds", () => {
    expect(assertIdempotencyKey(uniqueIdempotencyKey(), config)).toHaveLength(29);
    expect(assertIdempotencyKey("A".repeat(16), config)).toHaveLength(16);
    expect(assertIdempotencyKey(`${"A".repeat(64)}._:-okok`, config).includes("._:-")).toBe(true);
  });

  it("rejects short, long, or illegal keys", () => {
    expect(() => assertIdempotencyKey("short", config)).toThrow(ExecProtocolError);
    expect(() => assertIdempotencyKey("A".repeat(129), config)).toThrow(ExecProtocolError);
    expect(() => assertIdempotencyKey("spaces are not ok!!!!", config)).toThrow(ExecProtocolError);
    expect(() => assertIdempotencyKey("slash/not-allowed-123", config)).toThrow(ExecProtocolError);
  });

  it("canonicalizes intent so the same request compares equal and a changed toolCallId does not", () => {
    const input = inlineJsonInput({ a: 1 });
    const left = canonicalizeIntent({
      tenantId: "t",
      toolCallId: "tool-1-xxxxxxxxxx",
      kind: "echo",
      input,
    });
    const right = canonicalizeIntent({
      tenantId: "t",
      toolCallId: "tool-1-xxxxxxxxxx",
      kind: "echo",
      input,
    });
    const other = canonicalizeIntent({
      tenantId: "t",
      toolCallId: "tool-2-xxxxxxxxxx",
      kind: "echo",
      input,
    });
    expect(left).toBe(right);
    expect(left).not.toBe(other);
  });
});

describe("SHA-256 and byte-count checks", () => {
  it("accepts a full 64-hex digest with an optional sha256: prefix", () => {
    const digest = sha256Of(Buffer.from("hello", "utf8"));
    expect(normalizeSha256(digest)).toBe(digest);
    expect(normalizeSha256(`sha256:${digest}`)).toBe(digest);
    expect(normalizeSha256(`SHA256:${digest.toUpperCase()}`)).toBe(digest);
  });

  it("rejects truncated digests and checksum or byte-count mismatches", () => {
    const bytes = Buffer.from("payload", "utf8");
    const digest = sha256Of(bytes);
    expect(() => normalizeSha256(digest.slice(0, 12))).toThrow(ExecProtocolError);
    expect(() =>
      assertChecksumMatch({
        expectedSha256: digest,
        expectedByteCount: bytes.byteLength + 1,
        actual: bytes,
      }),
    ).toThrow(/mismatch/);
    expect(() =>
      assertChecksumMatch({
        expectedSha256: "0".repeat(64),
        expectedByteCount: bytes.byteLength,
        actual: bytes,
      }),
    ).toThrow(ExecProtocolError);
    try {
      assertChecksumMatch({
        expectedSha256: "0".repeat(64),
        expectedByteCount: bytes.byteLength,
        actual: bytes,
      });
    } catch (error) {
      expect((error as ExecProtocolError).code).toBe("EXEC_CHECKSUM_MISMATCH");
    }
  });
});
