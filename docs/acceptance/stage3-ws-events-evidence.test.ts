/**
 * Stage 3 six-column **WS 事件** slice (narrow).
 *
 * Proposition (§5.2 WS 事件): event frames carry optional `seq` / `stateVersion`;
 * delivery is limited to connected clients allowed by scope; unknown events must
 * not be confused with ack/res; versioning stays with PROTOCOL_VERSION.
 * Server-side event fan-out dedupe (`dedupeKey` TTL cache) is covered narrowly here.
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Backward compat: Swift EventFrame wire keys vs schema (narrow E2) covered below.
 *
 * Companion product: `server-broadcast.ts` (seq + EVENT_SCOPE_GUARDS + dedupeKey),
 * wired on exec.approval / device.pair / node.pair broadcasts,
 * `EventFrameSchema` / `validateEventFrame`, `gateway-misc.test.ts` scope fan-out,
 * generated `GatewayModels.swift` (macos + shared).
 */
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  validateEventFrame,
  validateResponseFrame,
} from "../../src/gateway/protocol/index.js";
import { createGatewayBroadcaster } from "../../src/gateway/server-broadcast.js";
import type { GatewayWsClient } from "../../src/gateway/server/ws-types.js";

function mockClient(params: { connId: string; role: string; scopes: string[] }): {
  client: GatewayWsClient;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const client = {
    socket: { send, bufferedAmount: 0, close: vi.fn() },
    connect: { role: params.role, scopes: params.scopes },
    connId: params.connId,
  } as unknown as GatewayWsClient;
  return { client, send };
}

function parseSent(send: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(send).toHaveBeenCalled();
  const raw = send.mock.calls[0]?.[0];
  expect(typeof raw).toBe("string");
  return JSON.parse(String(raw)) as Record<string, unknown>;
}

describe("Stage 3 WS 事件 schema (E2)", () => {
  it("EventFrameSchema accepts event + optional seq/stateVersion; rejects res-shaped and incomplete frames", () => {
    expect(
      validateEventFrame({
        type: "event",
        event: "tick",
        payload: { ts: 1 },
        seq: 3,
        stateVersion: { presence: 1, health: 2 },
      }),
    ).toBe(true);
    expect(validateEventFrame({ type: "event", event: "agent" })).toBe(true);
    expect(validateEventFrame({ type: "event" })).toBe(false);
    expect(validateEventFrame({ type: "res", id: "1", ok: true })).toBe(false);
    expect(validateEventFrame(null)).toBe(false);
    expect(
      validateEventFrame({
        type: "event",
        event: "tick",
        seq: -1,
      }),
    ).toBe(false);
  });

  it("protocol.md documents the event frame shape used by the schema", () => {
    const doc = fs.readFileSync(new URL("../../docs/gateway/protocol.md", import.meta.url), "utf8");
    expect(doc).toMatch(/type:\s*"event"/);
    expect(doc).toMatch(/seq\?/);
    expect(doc).toMatch(/stateVersion\?/);
  });
});

describe("Stage 3 WS 事件 versioning (E1)", () => {
  it("PROTOCOL_VERSION stays 3 and EventFrame lives in the protocol schema export surface", () => {
    expect(PROTOCOL_VERSION).toBe(3);
    const frames = fs.readFileSync(
      new URL("../../src/gateway/protocol/schema/frames.ts", import.meta.url),
      "utf8",
    );
    expect(frames).toContain("EventFrameSchema");
    expect(frames).toContain('type: Type.Literal("event")');
    expect(frames).toContain("seq: Type.Optional");
    expect(frames).toContain("stateVersion: Type.Optional");
  });
});

describe("Stage 3 WS 事件 authz (E3, scope-gated broadcast)", () => {
  it("scope-guarded events reach only operators with matching scopes; seq increments on fan-out", () => {
    const approvals = mockClient({
      connId: "c-approvals",
      role: "operator",
      scopes: ["operator.approvals"],
    });
    const pairing = mockClient({
      connId: "c-pairing",
      role: "operator",
      scopes: ["operator.pairing"],
    });
    const readOnly = mockClient({
      connId: "c-read",
      role: "operator",
      scopes: ["operator.read"],
    });
    const nodeRole = mockClient({
      connId: "c-node",
      role: "node",
      scopes: ["operator.approvals", "operator.admin"],
    });

    const { broadcast, broadcastToConnIds } = createGatewayBroadcaster({
      clients: new Set([approvals.client, pairing.client, readOnly.client, nodeRole.client]),
    });

    broadcast("exec.approval.requested", { id: "a1" });
    expect(approvals.send).toHaveBeenCalledTimes(1);
    expect(pairing.send).toHaveBeenCalledTimes(0);
    expect(readOnly.send).toHaveBeenCalledTimes(0);
    expect(nodeRole.send).toHaveBeenCalledTimes(0);

    const first = parseSent(approvals.send);
    expect(first.type).toBe("event");
    expect(first.event).toBe("exec.approval.requested");
    expect(first.seq).toBe(1);
    expect(validateEventFrame(first)).toBe(true);

    broadcast("device.pair.requested", { requestId: "r1" }, { stateVersion: { presence: 9 } });
    expect(pairing.send).toHaveBeenCalledTimes(1);
    expect(approvals.send).toHaveBeenCalledTimes(1);
    const pairFrame = parseSent(pairing.send);
    expect(pairFrame.event).toBe("device.pair.requested");
    expect(pairFrame.seq).toBe(2);
    expect(pairFrame.stateVersion).toEqual({ presence: 9 });

    // Targeted delivery omits seq (product: targeted !== global fan-out counter).
    broadcastToConnIds("tick", { ts: 1 }, new Set(["c-read"]));
    expect(readOnly.send).toHaveBeenCalledTimes(1);
    const tick = parseSent(readOnly.send);
    expect(tick.event).toBe("tick");
    expect(tick.seq).toBeUndefined();
    expect(validateEventFrame(tick)).toBe(true);
  });
});

describe("Stage 3 WS 事件 errors (E2, frame discrimination)", () => {
  it("unknown event names stay type:event frames and never validate as res/ack", () => {
    const unknownEvent = {
      type: "event" as const,
      event: "totally.unknown.event.v9",
      payload: { note: "clients must not treat this as ack" },
      seq: 7,
    };
    expect(validateEventFrame(unknownEvent)).toBe(true);
    expect(validateResponseFrame(unknownEvent)).toBe(false);
    expect(
      validateResponseFrame({
        type: "res",
        id: "1",
        ok: true,
        payload: { event: "totally.unknown.event.v9" },
      }),
    ).toBe(true);
  });
});

describe("Stage 3 WS 事件 idempotency (E3, server-side event dedupe cache)", () => {
  it("identical dedupeKey within TTL suppresses re-fan-out and does not bump seq", () => {
    let nowMs = 1_000_000;
    const { client, send } = mockClient({
      connId: "c-approvals",
      role: "operator",
      scopes: ["operator.approvals"],
    });
    const { broadcast } = createGatewayBroadcaster({
      clients: new Set([client]),
      now: () => nowMs,
      defaultDedupeTtlMs: 5_000,
    });

    broadcast(
      "exec.approval.requested",
      { id: "a1" },
      {
        dedupeKey: "exec.approval.requested:a1",
      },
    );
    broadcast(
      "exec.approval.requested",
      { id: "a1" },
      {
        dedupeKey: "exec.approval.requested:a1",
      },
    );
    expect(send).toHaveBeenCalledTimes(1);
    const first = parseSent(send);
    expect(first.seq).toBe(1);

    // Different key still fans out and bumps seq.
    broadcast(
      "exec.approval.requested",
      { id: "a2" },
      {
        dedupeKey: "exec.approval.requested:a2",
      },
    );
    expect(send).toHaveBeenCalledTimes(2);
    const secondRaw = send.mock.calls[1]?.[0];
    const second = JSON.parse(String(secondRaw)) as Record<string, unknown>;
    expect(second.seq).toBe(2);

    // After TTL expires, same key fans out again.
    nowMs += 5_001;
    broadcast(
      "exec.approval.requested",
      { id: "a1" },
      {
        dedupeKey: "exec.approval.requested:a1",
      },
    );
    expect(send).toHaveBeenCalledTimes(3);
    const third = JSON.parse(String(send.mock.calls[2]?.[0])) as Record<string, unknown>;
    expect(third.seq).toBe(3);
  });

  it("broadcasts without dedupeKey are never suppressed by the event cache", () => {
    const { client, send } = mockClient({
      connId: "c-read",
      role: "operator",
      scopes: ["operator.read"],
    });
    const { broadcast } = createGatewayBroadcaster({
      clients: new Set([client]),
      defaultDedupeTtlMs: 60_000,
    });
    broadcast("tick", { ts: 1 });
    broadcast("tick", { ts: 1 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("Stage 3 WS 事件 backward compat (E2, Swift EventFrame vs schema)", () => {
  const schemaPath = new URL("../../dist/protocol.schema.json", import.meta.url);
  const macosSwiftPath = new URL(
    "../../apps/macos/Sources/OpenBotProtocol/GatewayModels.swift",
    import.meta.url,
  );
  const sharedSwiftPath = new URL(
    "../../apps/shared/OpenBotKit/Sources/OpenBotProtocol/GatewayModels.swift",
    import.meta.url,
  );

  function eventFrameWireKeysFromSchema(): string[] {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as {
      definitions?: { EventFrame?: { properties?: Record<string, unknown>; required?: string[] } };
    };
    const eventFrame = schema.definitions?.EventFrame;
    if (!eventFrame?.properties) {
      throw new Error("dist/protocol.schema.json missing definitions.EventFrame.properties");
    }
    return Object.keys(eventFrame.properties).toSorted();
  }

  function extractSwiftEventFrame(source: string): {
    structBody: string;
    wireKeys: string[];
  } {
    const start = source.indexOf("public struct EventFrame: Codable, Sendable {");
    expect(start).toBeGreaterThanOrEqual(0);
    const codingKeysMarker = "private enum CodingKeys: String, CodingKey {";
    const keysStart = source.indexOf(codingKeysMarker, start);
    expect(keysStart).toBeGreaterThan(start);
    const keysEnd = source.indexOf("\n    }", keysStart);
    expect(keysEnd).toBeGreaterThan(keysStart);
    const structEnd = source.indexOf("\n}", keysEnd);
    expect(structEnd).toBeGreaterThan(keysEnd);
    const structBody = source.slice(start, structEnd + 2);
    const keysBlock = source.slice(keysStart, keysEnd);
    const wireKeys: string[] = [];
    for (const line of keysBlock.split("\n")) {
      const aliased = line.match(/case\s+\w+\s*=\s*"([^"]+)"/);
      if (aliased) {
        wireKeys.push(aliased[1]);
        continue;
      }
      const plain = line.match(/case\s+(\w+)\b/);
      if (plain) {
        wireKeys.push(plain[1]);
      }
    }
    return { structBody, wireKeys: wireKeys.toSorted() };
  }

  it("both committed Swift GatewayModels EventFrame wire keys match schema EventFrame properties", () => {
    const schemaKeys = eventFrameWireKeysFromSchema();
    expect(schemaKeys).toEqual(["event", "payload", "seq", "stateVersion", "type"].toSorted());

    const macos = extractSwiftEventFrame(fs.readFileSync(macosSwiftPath, "utf8"));
    const shared = extractSwiftEventFrame(fs.readFileSync(sharedSwiftPath, "utf8"));

    expect(macos.wireKeys).toEqual(schemaKeys);
    expect(shared.wireKeys).toEqual(schemaKeys);
    // Generator keeps macos and shared EventFrame identical for this slice.
    expect(macos.structBody).toBe(shared.structBody);
    expect(macos.structBody).toContain('case stateversion = "stateVersion"');
    expect(macos.structBody).toMatch(/public let seq: Int\?/);
    expect(macos.structBody).toMatch(/public let type: String/);
    expect(macos.structBody).toMatch(/public let event: String/);
    // dedupeKey is broadcast-cache only, not an EventFrame wire field.
    expect(macos.structBody).not.toMatch(/dedupeKey/);
    expect(schemaKeys).not.toContain("dedupeKey");
  });

  it("schema EventFrame required keys stay type+event; optional seq/stateVersion/payload present", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as {
      definitions: {
        EventFrame: { required: string[]; properties: Record<string, unknown> };
      };
    };
    expect(schema.definitions.EventFrame.required.toSorted()).toEqual(["event", "type"]);
    expect(schema.definitions.EventFrame.properties).toHaveProperty("seq");
    expect(schema.definitions.EventFrame.properties).toHaveProperty("stateVersion");
    expect(schema.definitions.EventFrame.properties).toHaveProperty("payload");
  });
});
