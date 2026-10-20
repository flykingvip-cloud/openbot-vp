import { describe, expect, it } from "vitest";
import {
  DirectedResourceRegistry,
  evaluateDirectedGrant,
  type AuthoredPathSpan,
} from "./directed-resource.js";

const TURN = {
  tenantId: "t1",
  userId: "u1",
  sessionKey: "s1",
  turnId: "turn-1",
};

const BASE = { ...TURN, inboundMessageId: "msg-1", nodeId: "node-1" };

function span(overrides: Partial<AuthoredPathSpan> = {}): AuthoredPathSpan {
  return {
    startOffset: 10,
    endOffset: 48,
    sourceKind: "authored_text",
    normalizedInput: "/Users/demo/Desktop/pack.zip",
    requestedIntent: "read",
    ...overrides,
  };
}

describe("directed grant requires authored text plus explicit intent (design 4.5)", () => {
  it("grants when the user typed the path and asked to read it", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span()] });

    const record = registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" });
    expect(record).toBeDefined();
    const check = evaluateDirectedGrant({ record, turn: TURN });
    expect(check.granted).toBe(true);
    expect(check.granted && check.operationHint).toBe("fs.read");
  });

  it("maps archive inspection intent to an archive listing", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span({ requestedIntent: "inspect-archive" })] });
    const check = evaluateDirectedGrant({
      record: registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" }),
      turn: TURN,
    });
    expect(check.granted && check.operationHint).toBe("archive.list");
  });

  it("asks instead of reading when intent is unspecified (acceptance 6.5)", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span({ requestedIntent: "unspecified" })] });
    const check = evaluateDirectedGrant({
      record: registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" }),
      turn: TURN,
    });
    expect(check.granted).toBe(false);
    expect(!check.granted && check.reason).toBe("intent-unspecified");
  });

  it("does not store spans from quotes, code blocks, attachments or history (acceptance 6.4)", () => {
    const registry = new DirectedResourceRegistry();
    const result = registry.record({
      ...BASE,
      spans: [
        span({ sourceKind: "quoted_text" }),
        span({ sourceKind: "code_block" }),
        span({ sourceKind: "attachment_body" }),
        span({ sourceKind: "forwarded_text" }),
        span({ sourceKind: "history" }),
        span({ sourceKind: "link_preview" }),
        span({ sourceKind: "transcript" }),
      ],
    });
    expect(result.stored).toBe(0);
    expect(registry.list(TURN)).toHaveLength(0);
    expect(
      evaluateDirectedGrant({
        record: registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" }),
        turn: TURN,
      }).granted,
    ).toBe(false);
  });

  it("produces no grant when the channel supplied no spans (acceptance 9.6 case 9)", () => {
    // This is the fail-closed default for every channel that cannot distinguish
    // authored text from quoted text today.
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [] });
    const check = evaluateDirectedGrant({
      record: registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" }),
      turn: TURN,
    });
    expect(check.granted).toBe(false);
    expect(!check.granted && check.reason).toBe("no-record");
  });

  it("produces no grant when no record was ever created (acceptance 6.3)", () => {
    const registry = new DirectedResourceRegistry();
    const check = evaluateDirectedGrant({ record: undefined, turn: TURN });
    expect(check.granted).toBe(false);
    expect(!check.granted && check.reason).toBe("no-record");
    expect(registry.size()).toBe(0);
  });
});

describe("records are bound to one turn and cannot be extended", () => {
  it("refuses a record from a different turn or session", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span()] });
    const record = registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" });

    for (const wrongTurn of [
      { ...TURN, turnId: "turn-2" },
      { ...TURN, sessionKey: "s2" },
      { ...TURN, userId: "u2" },
      { ...TURN, tenantId: "t2" },
    ]) {
      const check = evaluateDirectedGrant({ record, turn: wrongTurn });
      expect(check.granted).toBe(false);
      expect(!check.granted && check.reason).toBe("turn-mismatch");
    }
  });

  it("is not visible from a different turn key", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span()] });
    expect(registry.list({ ...TURN, turnId: "turn-2" })).toHaveLength(0);
  });

  it("ignores a second recording for the same turn", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span()] });
    const second = registry.record({
      ...BASE,
      spans: [span({ normalizedInput: "/Users/demo/.ssh/id_ed25519" })],
    });
    expect(second.alreadyRecorded).toBe(true);
    expect(second.stored).toBe(0);
    // The smuggled span is not present.
    expect(registry.find({ ...TURN, rawPath: "/Users/demo/.ssh/id_ed25519" })).toBeUndefined();
    expect(registry.list(TURN)).toHaveLength(1);
  });

  it("freezes the stored span so a later stage cannot rewrite it", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span()] });
    const record = registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" });
    expect(record).toBeDefined();
    if (!record) {
      return;
    }
    expect(Object.isFrozen(record.rawPathSpan)).toBe(true);
  });

  it("matches on the raw text the user wrote, not on a resolved path", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span({ normalizedInput: "~/Desktop/pack.zip" })] });
    // A model that learned the canonical path elsewhere cannot use it to match.
    expect(registry.find({ ...TURN, rawPath: "/Users/demo/Desktop/pack.zip" })).toBeUndefined();
    expect(registry.find({ ...TURN, rawPath: "~/Desktop/pack.zip" })).toBeDefined();
  });

  it("records one entry per named file and does not widen to a shared parent", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({
      ...BASE,
      spans: [
        span({ normalizedInput: "~/Desktop/a.zip" }),
        span({ normalizedInput: "~/Desktop/b.zip" }),
      ],
    });
    expect(registry.list(TURN)).toHaveLength(2);
    // The common parent is not granted.
    expect(registry.find({ ...TURN, rawPath: "~/Desktop" })).toBeUndefined();
  });

  it("drops records when the turn is cleared", () => {
    const registry = new DirectedResourceRegistry();
    registry.record({ ...BASE, spans: [span()] });
    registry.clearTurn(TURN);
    expect(registry.list(TURN)).toHaveLength(0);
  });
});
