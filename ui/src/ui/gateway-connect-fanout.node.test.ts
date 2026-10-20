import { describe, expect, it } from "vitest";
import { shouldUseLeanGatewayConnectFanout } from "./gateway-connect-fanout.ts";

describe("lean gateway connect fan-out gate", () => {
  it("uses lean connect for enterprise organization / settings / mesh", () => {
    expect(shouldUseLeanGatewayConnectFanout("enterpriseOrganization")).toBe(true);
    expect(shouldUseLeanGatewayConnectFanout("enterpriseSettings")).toBe(true);
    expect(shouldUseLeanGatewayConnectFanout("enterpriseMesh")).toBe(true);
    expect(shouldUseLeanGatewayConnectFanout("enterpriseBudget")).toBe(true);
  });

  it("keeps full fan-out for employee / chat workbench tabs", () => {
    expect(shouldUseLeanGatewayConnectFanout("chat")).toBe(false);
    expect(shouldUseLeanGatewayConnectFanout("overview")).toBe(false);
    expect(shouldUseLeanGatewayConnectFanout("agents")).toBe(false);
  });
});
