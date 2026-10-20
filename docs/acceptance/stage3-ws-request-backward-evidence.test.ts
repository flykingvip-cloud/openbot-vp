/**
 * Stage 3 six-column **WS 请求/响应 backward compat** slice (narrow E1/E2).
 *
 * Proposition (§5.2 WS 请求 backward): legacy connect `client.id` values are
 * accepted only via the single alias table in `client-info.ts`
 * (`LEGACY_GATEWAY_CLIENT_ID_ALIASES`), then normalized to canonical ids.
 * ConnectParams schema accepts the union of canonical + that alias table;
 * unknown ids are rejected. Handshake wiring calls `normalizeGatewayClientId`.
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not WS request authz (token/role/scopes/device signature) — still NOT_COVERED.
 * Not a live multi-device handshake suite / not Stage 7 device happy_path.
 *
 * Anchors: `src/gateway/protocol/client-info.ts`,
 * `GatewayClientIdSchema` / `validateConnectParams`,
 * `message-handler.ts` connect normalize.
 */
import fs from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_GATEWAY_CLIENT_ID_VALUES,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  LEGACY_GATEWAY_CLIENT_ID_ALIASES,
  normalizeGatewayClientId,
} from "../../src/gateway/protocol/client-info.js";
import { validateConnectParams } from "../../src/gateway/protocol/index.js";
import { GatewayClientIdSchema } from "../../src/gateway/protocol/schema/primitives.js";

function makeConnectParams(clientId: string) {
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: clientId,
      version: "0.0.0-inventory",
      platform: "test",
      mode: GATEWAY_CLIENT_MODES.TEST,
    },
    role: "operator",
    scopes: ["operator.read"],
  };
}

describe("Stage 3 WS 请求 backward compat (E1/E2 narrow)", () => {
  it("legacy aliases normalize only through LEGACY_GATEWAY_CLIENT_ID_ALIASES", () => {
    const aliases = Object.entries(LEGACY_GATEWAY_CLIENT_ID_ALIASES);
    expect(aliases.length).toBeGreaterThanOrEqual(5);

    for (const [legacy, canonical] of aliases) {
      expect(normalizeGatewayClientId(legacy)).toBe(canonical);
      // Case / whitespace still resolve via the same table after normalize.
      expect(normalizeGatewayClientId(` ${legacy.toUpperCase()} `)).toBe(canonical);
    }

    // Canonical ids stay identity; unknown stays undefined (no second table invents them).
    expect(normalizeGatewayClientId(GATEWAY_CLIENT_IDS.MACOS_APP)).toBe(
      GATEWAY_CLIENT_IDS.MACOS_APP,
    );
    expect(normalizeGatewayClientId("openclaw-mobile")).toBeUndefined();
    expect(normalizeGatewayClientId("totally-unknown-client")).toBeUndefined();
  });

  it("ConnectParams / GatewayClientIdSchema accept canonical+legacy and reject unknown", () => {
    for (const id of Object.values(GATEWAY_CLIENT_IDS)) {
      expect(Value.Check(GatewayClientIdSchema, id), `canonical ${id}`).toBe(true);
      expect(validateConnectParams(makeConnectParams(id)), `connect canonical ${id}`).toBe(true);
    }
    for (const legacy of Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES)) {
      expect(Value.Check(GatewayClientIdSchema, legacy), `legacy schema ${legacy}`).toBe(true);
      expect(validateConnectParams(makeConnectParams(legacy)), `connect legacy ${legacy}`).toBe(
        true,
      );
    }

    expect(ACCEPTED_GATEWAY_CLIENT_ID_VALUES).toEqual(
      expect.arrayContaining([
        ...Object.values(GATEWAY_CLIENT_IDS),
        ...Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES),
      ]),
    );

    expect(Value.Check(GatewayClientIdSchema, "nope-not-a-client")).toBe(false);
    expect(validateConnectParams(makeConnectParams("nope-not-a-client"))).toBe(false);
    expect(validateConnectParams(makeConnectParams("openclaw-mobile"))).toBe(false);
  });

  it("connect handshake wiring uses normalizeGatewayClientId; no second alias table", () => {
    const handler = fs.readFileSync(
      new URL("../../src/gateway/server/ws-connection/message-handler.ts", import.meta.url),
      "utf8",
    );
    expect(handler).toMatch(/normalizeGatewayClientId\s*\(\s*connectParams\.client\.id\s*\)/);
    expect(handler).toMatch(/from\s+["'].*client-info\.js["']/);

    const primitives = fs.readFileSync(
      new URL("../../src/gateway/protocol/schema/primitives.ts", import.meta.url),
      "utf8",
    );
    expect(primitives).toContain("ACCEPTED_GATEWAY_CLIENT_ID_VALUES");
    expect(primitives).toContain("GatewayClientIdSchema");
    // Schema must not invent its own hard-coded openclaw-* list beside the alias table.
    expect(primitives).not.toMatch(/"openclaw-macos"/);

    const clientInfo = fs.readFileSync(
      new URL("../../src/gateway/protocol/client-info.ts", import.meta.url),
      "utf8",
    );
    expect(clientInfo).toContain("LEGACY_GATEWAY_CLIENT_ID_ALIASES");
    expect(clientInfo).toContain('"openclaw-macos"');
    expect(clientInfo).toContain('"moltbot-macos"');
  });
});
