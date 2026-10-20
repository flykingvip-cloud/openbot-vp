import { describe, expect, it } from "vitest";
import type { DedupeEntry } from "../server-shared.js";
import {
  classifyIdempotencyReplay,
  fingerprintIdempotencyPayload,
  idempotencyPayloadConflictError,
} from "./idempotency-payload.js";

describe("idempotency payload fingerprint", () => {
  it("ignores object key order and rejects a different payload", () => {
    const left = fingerprintIdempotencyPayload({ b: 1, a: { z: true, y: "hi" } });
    const right = fingerprintIdempotencyPayload({ a: { y: "hi", z: true }, b: 1 });
    expect(left).toBe(right);

    const entry: DedupeEntry = {
      ts: 1,
      ok: true,
      payload: { messageId: "m1" },
      payloadFingerprint: left,
    };
    expect(classifyIdempotencyReplay(entry, right).kind).toBe("replay");
    expect(
      classifyIdempotencyReplay(entry, fingerprintIdempotencyPayload({ a: 1, b: 2 })).kind,
    ).toBe("conflict");
    expect(
      classifyIdempotencyReplay({ ts: 1, ok: true, payload: { messageId: "m1" } }, left).kind,
    ).toBe("conflict");
    expect(classifyIdempotencyReplay(undefined, left).kind).toBe("miss");
  });

  it("shapes the conflict as a rejection with status 409", () => {
    expect(idempotencyPayloadConflictError()).toMatchObject({
      code: "INVALID_REQUEST",
      message: "idempotency key reused with a different payload",
      details: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT", status: 409 },
    });
  });
});
