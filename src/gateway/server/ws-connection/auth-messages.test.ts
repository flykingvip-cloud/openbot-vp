import { describe, expect, it } from "vitest";
import { GATEWAY_CLIENT_NAMES } from "../../protocol/client-info.js";
import { formatGatewayAuthFailureMessage } from "./auth-messages.js";

const CONTROL_UI_CLIENT = { id: GATEWAY_CLIENT_NAMES.CONTROL_UI, mode: "webchat" };
const CLI_CLIENT = { id: GATEWAY_CLIENT_NAMES.CLI, mode: "cli" };

describe("formatGatewayAuthFailureMessage", () => {
  it("keeps token paste hints for token mode control ui clients", () => {
    expect(
      formatGatewayAuthFailureMessage({
        authMode: "token",
        authProvided: "none",
        reason: "token_missing",
        client: CONTROL_UI_CLIENT,
      }),
    ).toContain("Control UI settings");
  });

  it("uses platform login guidance for trusted-proxy control ui without session", () => {
    expect(
      formatGatewayAuthFailureMessage({
        authMode: "trusted-proxy",
        authProvided: "none",
        reason: "trusted_proxy_user_missing",
        client: CONTROL_UI_CLIENT,
      }),
    ).toBe(
      "unauthorized: platform session missing (sign in through platform or enterprise login, then refresh)",
    );
  });

  it("blocks direct browser access messaging for trusted-proxy untrusted source", () => {
    expect(
      formatGatewayAuthFailureMessage({
        authMode: "trusted-proxy",
        authProvided: "none",
        reason: "trusted_proxy_untrusted_source",
        client: CONTROL_UI_CLIENT,
      }),
    ).toContain("direct gateway access blocked");
  });

  it("keeps operator-oriented trusted-proxy errors for cli clients", () => {
    expect(
      formatGatewayAuthFailureMessage({
        authMode: "trusted-proxy",
        authProvided: "none",
        reason: "trusted_proxy_untrusted_source",
        client: CLI_CLIENT,
      }),
    ).toContain("gateway.trustedProxies");
  });

  it("maps missing required proxy headers to browser-friendly copy", () => {
    expect(
      formatGatewayAuthFailureMessage({
        authMode: "trusted-proxy",
        authProvided: "none",
        reason: "trusted_proxy_missing_header_x-forwarded-proto",
        client: CONTROL_UI_CLIENT,
      }),
    ).toContain("reverse proxy session incomplete");
  });
});
