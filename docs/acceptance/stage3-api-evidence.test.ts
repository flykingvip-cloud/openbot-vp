/**
 * Stage 3 API contract evidence.
 *
 * API-01 timeout/retry: classify/replay helpers here; full in-flight join is in
 * `src/gateway/server-methods/send.test.ts` ("joins an in-flight send when the
 * same key carries the same payload (timeout retry)").
 *
 * API-02: AJV validators reject malformed send params / request frames (E2).
 * Wire E3 lives in `src/gateway/server.ws-malformed-frame.test.ts` (disconnect /
 * reconnect). Not a full fuzz corpus — Stage 3 overall is still not PASS.
 *
 * API-03: HTTP `/tools/invoke` policy 404/deny E3 is in
 * `tools-invoke-http.test.ts`. Enterprise fail-closed explicit errors are in
 * `stage3-api03-policy-evidence.test.ts`. This file does not re-mock either.
 *
 * Six-column supplements here are E1 only (PROTOCOL_VERSION, CLI name sample).
 * Plugin lint is recorded from `pnpm lint:plugins:no-monolithic-plugin-sdk-entry-imports`
 * in the ledger command table, not re-mocked here.
 *
 * stage8_eligible stays false. Stage 3 overall is not PASS.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCoreCliCommandNames } from "../../src/cli/program/command-registry.js";
import {
  PROTOCOL_VERSION,
  validateRequestFrame,
  validateSendParams,
} from "../../src/gateway/protocol/index.js";
import {
  classifyIdempotencyReplay,
  fingerprintIdempotencyPayload,
} from "../../src/gateway/server-methods/idempotency-payload.js";

describe("Stage 3 API-01 timeout/retry helpers", () => {
  it("replays a completed entry with the same fingerprint and conflicts on drift", () => {
    const fingerprint = fingerprintIdempotencyPayload({
      to: "channel:C1",
      message: "hi",
      idempotencyKey: "k1",
    });
    const entry = {
      ts: Date.now(),
      ok: true as const,
      payload: { messageId: "m1" },
      payloadFingerprint: fingerprint,
    };
    expect(classifyIdempotencyReplay(entry, fingerprint).kind).toBe("replay");
    expect(
      classifyIdempotencyReplay(entry, fingerprintIdempotencyPayload({ message: "other" })).kind,
    ).toBe("conflict");
    expect(classifyIdempotencyReplay(undefined, fingerprint).kind).toBe("miss");
  });
});

describe("Stage 3 API-02 malformed params / frames", () => {
  it("rejects send params missing idempotencyKey and accepts a minimal valid shape", () => {
    expect(validateSendParams({ to: "channel:C1", message: "hi" })).toBe(false);
    expect(
      validateSendParams({
        to: "channel:C1",
        message: "hi",
        idempotencyKey: "stage3-api02",
      }),
    ).toBe(true);
  });

  it("rejects a request frame that is not a complete req object", () => {
    expect(validateRequestFrame(null)).toBe(false);
    expect(validateRequestFrame({ type: "req" })).toBe(false);
    expect(
      validateRequestFrame({
        type: "req",
        id: "1",
        method: "send",
        params: { to: "x", message: "y", idempotencyKey: "k" },
      }),
    ).toBe(true);
  });
});

describe("Stage 3 six-column E1 supplements (not stage PASS)", () => {
  it("PROTOCOL_VERSION is 3 matching docs/gateway/protocol.md examples", () => {
    // Docs examples use minProtocol/maxProtocol: 3; schema constant is the server pin.
    expect(PROTOCOL_VERSION).toBe(3);
  });

  it("core CLI registry names have matching docs/cli pages for a five-command sample", () => {
    const names = getCoreCliCommandNames();
    const sample = ["setup", "onboard", "doctor", "dashboard", "agent"] as const;
    for (const name of sample) {
      expect(names).toContain(name);
      expect(existsSync(`docs/cli/${name}.md`)).toBe(true);
    }
    // gateway is a subcli (register.subclis), not a core primary — still documented.
    expect(names).not.toContain("gateway");
    expect(existsSync("docs/cli/gateway.md")).toBe(true);
  });
});
