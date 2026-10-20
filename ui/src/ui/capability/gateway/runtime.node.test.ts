import { describe, expect, it } from "vitest";
import { resolveAuthenticatedControlUiGatewayUrl } from "./runtime.ts";

const employeeSession = {
  provider: "trusted-proxy" as const,
  user: "employee@example.com",
};

describe("resolveAuthenticatedControlUiGatewayUrl", () => {
  it("moves an authenticated public workbench from a stale gateway subdomain to its page origin", () => {
    expect(
      resolveAuthenticatedControlUiGatewayUrl({
        gatewayUrl: "wss://gw.openbot.love",
        bootstrapAuthMode: "trusted-proxy",
        bootstrapAuthSession: employeeSession,
        pageUrl: "https://openbot.love/?session=agent%3Amain%3Amain",
      }),
    ).toBe("wss://openbot.love");
  });

  it("preserves the configured gateway for anonymous sessions", () => {
    expect(
      resolveAuthenticatedControlUiGatewayUrl({
        gatewayUrl: "wss://gw.openbot.love",
        bootstrapAuthMode: "trusted-proxy",
        bootstrapAuthSession: null,
        pageUrl: "https://openbot.love/",
      }),
    ).toBe("wss://gw.openbot.love");
  });

  it("preserves explicit token and remote gateway flows", () => {
    expect(
      resolveAuthenticatedControlUiGatewayUrl({
        gatewayUrl: "wss://gateway.example.com/openclaw",
        bootstrapAuthMode: "token",
        bootstrapAuthSession: employeeSession,
        pageUrl: "https://openbot.love/",
      }),
    ).toBe("wss://gateway.example.com/openclaw");
  });

  it("keeps the configured base path when the workbench is served below one", () => {
    expect(
      resolveAuthenticatedControlUiGatewayUrl({
        gatewayUrl: "wss://gw.openbot.love/legacy",
        bootstrapAuthMode: "trusted-proxy",
        bootstrapAuthSession: employeeSession,
        pageUrl: "https://openbot.love/openbot/chat",
      }),
    ).toBe("wss://openbot.love/openbot");
  });
});
