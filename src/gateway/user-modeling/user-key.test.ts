import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  extractPeerIdFromSessionKey,
  hashUserKey,
  resolveUserModelingKey,
  resolveUserModelingKeyFromContext,
} from "./user-key.js";

const cfg = {
  session: { identityLinks: { alice: ["telegram:111", "discord:222"] } },
} as OpenBotConfig;

describe("resolveUserModelingKey", () => {
  it("returns null for anonymous peer", () => {
    expect(resolveUserModelingKey({ channel: "telegram", peerId: "unknown" })).toBeNull();
    expect(resolveUserModelingKey({ channel: "telegram", peerId: "" })).toBeNull();
  });

  it("merges identityLinks to canonical id", () => {
    const key = resolveUserModelingKey({
      channel: "telegram",
      peerId: "111",
      identityLinks: cfg.session?.identityLinks,
    });
    expect(key?.canonicalId).toBe("alice");
  });

  it("scopes hash by tenant", () => {
    const a = hashUserKey({ canonicalId: "alice", tenantId: "t1" });
    const b = hashUserKey({ canonicalId: "alice", tenantId: "t2" });
    expect(a).not.toBe(b);
  });
});

describe("resolveUserModelingKeyFromContext", () => {
  it("uses webchat email when sender is missing", () => {
    const key = resolveUserModelingKeyFromContext({
      cfg,
      sessionKey: "agent:main:direct:unknown",
      sessionCtx: { GatewayClientUser: "User@Example.com" },
      ctx: { GatewayClientUser: "User@Example.com" },
    });
    expect(key?.canonicalId).toBe("webchat:user@example.com");
  });

  it("extracts peer from session key", () => {
    expect(extractPeerIdFromSessionKey("agent:main:telegram:direct:999")).toBe("999");
  });
});
