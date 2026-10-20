import { describe, expect, it } from "vitest";
import {
  buildAuditRecord,
  findForbiddenAuditFields,
  InMemoryAuditSink,
  redactPathForAudit,
} from "./audit.js";
import type { CapabilityBinding } from "./types.js";

const BINDING: CapabilityBinding = {
  tenantId: "t1",
  userId: "u1",
  agentId: "bot-skill",
  sessionKey: "s1",
  turnId: "turn-1",
  nodeId: "node-abc",
  devicePublicKey: "key-abc",
};

const HOME = "/Users/demo";
const NOW = 1_800_000_000_000;

describe("audit records carry the design 4.12 fields", () => {
  it("includes identity, operation, decision and byte accounting", () => {
    const record = buildAuditRecord({
      binding: BINDING,
      inboundMessageId: "msg-1",
      operation: "archive.readEntry",
      canonicalPath: "/Users/demo/Desktop/pack.zip",
      homeDir: HOME,
      grantSource: "user-directed",
      decision: "allowed",
      bytesReturned: 1234,
      contentHash: "a".repeat(64),
      truncated: false,
      startedAtMs: NOW - 42,
      nowMs: NOW,
    });

    expect(record.tenantId).toBe("t1");
    expect(record.userId).toBe("u1");
    expect(record.agentId).toBe("bot-skill");
    expect(record.sessionKey).toBe("s1");
    expect(record.turnId).toBe("turn-1");
    expect(record.inboundMessageId).toBe("msg-1");
    expect(record.nodeId).toBe("node-abc");
    expect(record.operation).toBe("archive.readEntry");
    expect(record.grantSource).toBe("user-directed");
    expect(record.decision).toBe("allowed");
    expect(record.bytesReturned).toBe(1234);
    expect(record.truncated).toBe(false);
    expect(record.durationMs).toBe(42);
    expect(record.pathHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records a denial with its reason and no content fields", () => {
    const record = buildAuditRecord({
      binding: BINDING,
      operation: "fs.read",
      canonicalPath: "/Users/demo/.ssh/id_ed25519",
      homeDir: HOME,
      decision: "denied",
      denyReason: "system-path",
      errorCode: "PERMISSION_DENIED",
      startedAtMs: NOW,
      nowMs: NOW,
    });
    expect(record.decision).toBe("denied");
    expect(record.denyReason).toBe("system-path");
    expect(record.errorCode).toBe("PERMISSION_DENIED");
    expect(record.bytesReturned).toBeUndefined();
    expect(record.contentHash).toBeUndefined();
  });
});

describe("audit records never carry content or tokens (acceptance 6.14)", () => {
  it("has no field for content, capability material or the full path", () => {
    const record = buildAuditRecord({
      binding: BINDING,
      operation: "fs.read",
      canonicalPath: "/Users/demo/Desktop/secret-project/notes.txt",
      homeDir: HOME,
      decision: "allowed",
      bytesReturned: 10,
      contentHash: "b".repeat(64),
      startedAtMs: NOW,
      nowMs: NOW,
    });
    expect(findForbiddenAuditFields(record)).toEqual([]);

    // The serialized record must not contain the full local path either.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("/Users/demo/Desktop/secret-project/notes.txt");
    expect(serialized).not.toContain("secret-project");
  });

  it("redacts the path to a recognisable but incomplete form", () => {
    expect(redactPathForAudit("/Users/demo/Desktop/pack.zip", HOME)).toBe("~/Desktop/p….zip");
    // Intermediate directories are elided.
    const deep = redactPathForAudit("/Users/demo/Documents/clients/acme/contract.pdf", HOME);
    expect(deep).toContain("~/Documents");
    expect(deep).toContain("…");
    expect(deep).not.toContain("acme");
    expect(deep).not.toContain("clients");
  });

  it("still redacts when the path is outside the known home directory", () => {
    const redacted = redactPathForAudit("/Volumes/USB/private/thing.txt");
    expect(redacted).not.toContain("private");
  });
});

describe("audit sink", () => {
  it("collects records in order", () => {
    const sink = new InMemoryAuditSink();
    for (const decision of ["allowed", "denied"] as const) {
      sink.write(
        buildAuditRecord({
          binding: BINDING,
          operation: "fs.stat",
          canonicalPath: "/Users/demo/Desktop/a.txt",
          homeDir: HOME,
          decision,
          startedAtMs: NOW,
          nowMs: NOW,
        }),
      );
    }
    expect(sink.all().map((r) => r.decision)).toEqual(["allowed", "denied"]);
    sink.clear();
    expect(sink.all()).toHaveLength(0);
  });
});
