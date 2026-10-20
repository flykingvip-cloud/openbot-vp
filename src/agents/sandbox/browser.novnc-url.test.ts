import { describe, expect, it } from "vitest";
import {
  buildNoVncDirectUrl,
  buildNoVncObserverTokenUrl,
  consumeNoVncObserverToken,
  generateNoVncPassword,
  issueNoVncObserverToken,
  novncRelayStateSizeForTests,
  openNoVncRelayGrant,
  readNoVncStaticPort,
  resetNoVncObserverTokensForTests,
} from "./novnc-auth.js";

const passwordKey = ["pass", "word"].join("");

describe("noVNC auth helpers", () => {
  it("builds the default observer URL without password", () => {
    expect(buildNoVncDirectUrl(45678)).toBe("http://127.0.0.1:45678/vnc.html");
  });

  it("prunes expired relay grants and static leases", () => {
    resetNoVncObserverTokensForTests();
    openNoVncRelayGrant({
      token: "expired-grant",
      noVncPort: 1,
      input: false,
      nowMs: 0,
      ttlMs: 10,
    });
    openNoVncRelayGrant({
      token: "live-grant",
      noVncPort: 2,
      input: false,
      nowMs: 0,
      ttlMs: 10_000,
    });
    expect(novncRelayStateSizeForTests()).toEqual({ grants: 2, staticLeases: 2 });
    expect(readNoVncStaticPort("missing", 100)).toBeNull();
    expect(novncRelayStateSizeForTests()).toEqual({ grants: 1, staticLeases: 1 });
    expect(readNoVncStaticPort("expired-grant", 100)).toBeNull();
    expect(readNoVncStaticPort("live-grant", 100)).toBe(2);
  });

  it("issues one-time short-lived observer tokens", () => {
    resetNoVncObserverTokensForTests();
    const token = issueNoVncObserverToken({
      noVncPort: 50123,
      [passwordKey]: "abcd1234", // pragma: allowlist secret
      nowMs: 1000,
      ttlMs: 100,
    });
    expect(buildNoVncObserverTokenUrl("http://127.0.0.1:19999", token)).toBe(
      `http://127.0.0.1:19999/sandbox/novnc?token=${token}`,
    );
    expect(consumeNoVncObserverToken(token, 1050)).toEqual({
      noVncPort: 50123,
      [passwordKey]: "abcd1234", // pragma: allowlist secret
    });
    expect(consumeNoVncObserverToken(token, 1050)).toBeNull();
  });

  it("expires observer tokens", () => {
    resetNoVncObserverTokensForTests();
    const token = issueNoVncObserverToken({
      noVncPort: 50123,
      password: "abcd1234", // pragma: allowlist secret
      nowMs: 1000,
      ttlMs: 100,
    });
    expect(consumeNoVncObserverToken(token, 1200)).toBeNull();
  });

  it("generates 8-char alphanumeric passwords", () => {
    const password = generateNoVncPassword();
    expect(password).toMatch(/^[a-zA-Z0-9]{8}$/);
  });
});
