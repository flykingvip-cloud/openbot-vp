import { describe, expect, it } from "vitest";
import {
  CANONICAL_EMPLOYEE_CLOUD_ORIGIN,
  canonicalizeEmployeeCloudGatewayHost,
  canonicalizeEmployeeCloudGatewayUrl,
} from "./canonical-employee-gateway.ts";

describe("canonicalizeEmployeeCloudGatewayUrl", () => {
  it("folds the legacy gw employee host onto www.openbot.love", () => {
    expect(canonicalizeEmployeeCloudGatewayUrl("https://gw.openbot.love")).toBe(
      CANONICAL_EMPLOYEE_CLOUD_ORIGIN,
    );
    expect(canonicalizeEmployeeCloudGatewayUrl("https://GW.OpenBot.love/")).toBe(
      CANONICAL_EMPLOYEE_CLOUD_ORIGIN,
    );
    expect(canonicalizeEmployeeCloudGatewayUrl("wss://gw.openbot.love")).toBe(
      "wss://www.openbot.love",
    );
  });

  it("leaves self-hosted and already-canonical cloud hosts unchanged", () => {
    expect(canonicalizeEmployeeCloudGatewayUrl("https://www.openbot.love")).toBe(
      "https://www.openbot.love",
    );
    expect(canonicalizeEmployeeCloudGatewayUrl("https://self.example:8443")).toBe(
      "https://self.example:8443",
    );
    expect(canonicalizeEmployeeCloudGatewayHost("gw.openbot.love")).toBe("www.openbot.love");
    expect(canonicalizeEmployeeCloudGatewayHost("biz.openbot.love")).toBe("biz.openbot.love");
  });
});
