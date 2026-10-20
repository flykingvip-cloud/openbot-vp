// @vitest-environment node
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_GATEWAY_CLIENT_ID_VALUES,
  GATEWAY_CLIENT_IDS,
  LEGACY_GATEWAY_CLIENT_ID_ALIASES,
  normalizeGatewayClientId,
} from "./client-info.js";
import { GatewayClientIdSchema } from "./schema/primitives.js";

describe("legacy gateway client id aliases", () => {
  it("normalizes legacy openclaw-* / moltbot-* ids to canonical", () => {
    expect(normalizeGatewayClientId("openclaw-macos")).toBe(GATEWAY_CLIENT_IDS.MACOS_APP);
    expect(normalizeGatewayClientId("moltbot-macos")).toBe(GATEWAY_CLIENT_IDS.MACOS_APP);
    expect(normalizeGatewayClientId("openclaw-ios")).toBe(GATEWAY_CLIENT_IDS.IOS_APP);
    expect(normalizeGatewayClientId("openclaw-android")).toBe(GATEWAY_CLIENT_IDS.ANDROID_APP);
    expect(normalizeGatewayClientId("openclaw-control-ui")).toBe(GATEWAY_CLIENT_IDS.CONTROL_UI);
  });

  it("still normalizes canonical ids and rejects unknown", () => {
    expect(normalizeGatewayClientId("openbot-macos")).toBe(GATEWAY_CLIENT_IDS.MACOS_APP);
    expect(normalizeGatewayClientId("totally-unknown")).toBeUndefined();
    expect(normalizeGatewayClientId(" ")).toBeUndefined();
  });

  it("connect schema accepts legacy ids (so stale installed apps can connect)", () => {
    for (const legacy of Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES)) {
      expect(Value.Check(GatewayClientIdSchema, legacy)).toBe(true);
    }
    // canonical still accepted
    expect(Value.Check(GatewayClientIdSchema, GATEWAY_CLIENT_IDS.MACOS_APP)).toBe(true);
    // unknown rejected
    expect(Value.Check(GatewayClientIdSchema, "nope-not-a-client")).toBe(false);
  });

  it("accepted values list = canonical + legacy aliases", () => {
    expect(ACCEPTED_GATEWAY_CLIENT_ID_VALUES).toEqual(
      expect.arrayContaining([
        ...Object.values(GATEWAY_CLIENT_IDS),
        ...Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES),
      ]),
    );
  });
});
