// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { __resetSeatsStoreForTest } from "../stores/seats-store.ts";
import { renderSeatsPage } from "./seats-page.ts";

describe("seats-page", () => {
  it("wraps v1 seats host with v2 test id", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderSeatsPage({
        client: null,
        readModel: null,
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-seats-page"]')).toBeTruthy();
  });

  it("shows gateway reconnect hint before WebSocket is open", () => {
    __resetSeatsStoreForTest();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const client = {
      connected: false,
      request: () => Promise.reject(new Error("not connected")),
    };
    render(
      renderSeatsPage({
        client: client as never,
        readModel: null,
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(
      container.querySelector('[data-testid="cost-budget-v2-gateway-reconnect-hint"]'),
    ).toBeTruthy();
  });
});
