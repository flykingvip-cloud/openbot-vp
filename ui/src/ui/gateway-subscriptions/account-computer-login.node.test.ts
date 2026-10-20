import { describe, expect, it } from "vitest";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import {
  handleAccountComputerLoginGatewayEvent,
  type AccountComputerLoginGatewayHost,
} from "./account-computer-login.ts";

function host(): AccountComputerLoginGatewayHost {
  return {
    sessionKey: "session-1",
    loginMethodChoice: null,
    loginSaveOffer: null,
    loginCardBusy: false,
    loginCardError: null,
  } as AccountComputerLoginGatewayHost;
}

function event(name: string, payload: unknown): GatewayEventFrame {
  return { type: "event", event: name, payload } as GatewayEventFrame;
}

describe("account computer login gateway events", () => {
  it("shows a choice for this session and clears it when resolved", () => {
    const h = host();
    expect(
      handleAccountComputerLoginGatewayEvent(
        h as unknown as GatewayHost,
        event("account_computer_login.choice_offered", {
          choiceId: "c1",
          sessionKey: "session-1",
          host: "login.example.com",
          methods: ["password", "qr"],
        }),
      ),
    ).toBe(true);
    expect(h.loginMethodChoice?.choiceId).toBe("c1");
    handleAccountComputerLoginGatewayEvent(
      h as unknown as GatewayHost,
      event("account_computer_login.choice_offered", {
        choiceId: "c2",
        sessionKey: "other",
        host: "login.example.com",
        methods: ["qr"],
      }),
    );
    expect(h.loginMethodChoice?.choiceId).toBe("c1");
    handleAccountComputerLoginGatewayEvent(
      h as unknown as GatewayHost,
      event("account_computer_login.choice_resolved", { choiceId: "c1" }),
    );
    expect(h.loginMethodChoice).toBeNull();
  });

  it("shows the save prompt without reading a secret", () => {
    const h = host();
    handleAccountComputerLoginGatewayEvent(
      h as unknown as GatewayHost,
      event("account_computer_login.save_offered", {
        saveId: "s1",
        sessionKey: "session-1",
        host: "login.example.com",
        password: "should-not-stick",
      }),
    );
    expect(h.loginSaveOffer).toEqual({
      saveId: "s1",
      sessionKey: "session-1",
      host: "login.example.com",
    });
    expect(JSON.stringify(h.loginSaveOffer)).not.toContain("should-not-stick");
  });
});
