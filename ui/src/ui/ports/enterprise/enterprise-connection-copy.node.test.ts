import { describe, expect, it } from "vitest";
import { resolveAssignedSeatCount } from "../../views/cost-budget/assigned-seat-count.ts";
import {
  isDataSourceHealthyStatus,
  normalizeDataSourceHealthStatus,
} from "../../views/enterprise-data-capability/source-health-status.ts";
import {
  displayEnterpriseLastError,
  formatEnterpriseRoleLabel,
  formatEnterpriseRuntimeLabel,
  formatEnterpriseStatusLabel,
  localizeEnterpriseGatewayError,
  localizeEnterpriseGatewayThrown,
  resolveEnterpriseConnectionView,
  resolveIdleSeatCount,
} from "./enterprise-connection-copy.ts";
import { formatSourceActionMismatchMessage } from "./views/enterprise-data-capability/product-wizard.ts";

describe("resolveEnterpriseConnectionView", () => {
  it("stays quiet while the gateway is still connecting", () => {
    const view = resolveEnterpriseConnectionView({
      connected: false,
      connectionPhase: "connecting",
    });
    expect(view.phase).toBe("loading");
    expect(view.showBanner).toBe(false);
    expect(view.label).toBe("连接中");
  });

  it("drops the disconnect banner after a payload arrives during rebind", () => {
    const view = resolveEnterpriseConnectionView({
      connected: false,
      connectionPhase: "reconnecting",
      lastError: "gateway rebinding for Control UI surface change; please retry",
      payloadReady: true,
    });
    expect(view.showBanner).toBe(false);
    expect(view.phase).toBe("ready");
    expect(
      displayEnterpriseLastError({
        connected: false,
        connectionPhase: "reconnecting",
        lastError: "gateway rebinding for Control UI surface change; please retry",
        payloadReady: true,
      }),
    ).toBeNull();
  });

  it("keeps an auth failure visible", () => {
    const view = resolveEnterpriseConnectionView({
      connected: false,
      lastError: "unauthorized",
      authIssue: true,
    });
    expect(view.showBanner).toBe(true);
    expect(view.phase).toBe("disconnected");
  });
});

describe("enterprise copy", () => {
  it("localizes gateway rebind errors", () => {
    expect(
      localizeEnterpriseGatewayError(
        "gateway rebinding for Control UI surface change; please retry",
      ),
    ).toContain("重新绑定");
  });

  it("maps source/action connector mismatch to Chinese", () => {
    const english =
      "Action crm.customer.export@v1 must align with a linked DataSource connectorId.";
    expect(localizeEnterpriseGatewayError(english)).toBe(
      formatSourceActionMismatchMessage(["crm.customer.export@v1"]),
    );
    expect(
      localizeEnterpriseGatewayThrown(
        Object.assign(new Error(english), {
          details: { code: "DATA_CAPABILITY_SOURCE_ACTION_MISMATCH" },
        }),
        "请求失败",
      ),
    ).toBe(formatSourceActionMismatchMessage(["crm.customer.export@v1"]));
    expect(
      localizeEnterpriseGatewayThrown(
        Object.assign(new Error("rejected"), {
          details: { code: "DATA_CAPABILITY_SOURCE_ACTION_MISMATCH" },
        }),
        "请求失败",
      ),
    ).toBe(formatSourceActionMismatchMessage([]));
  });

  it("maps raw roles and statuses", () => {
    expect(formatEnterpriseRoleLabel("enterprise-admin")).toBe("企业管理员");
    expect(formatEnterpriseRoleLabel("operator")).toBe("操作员");
    expect(formatEnterpriseStatusLabel("active")).toBe("正常");
    expect(formatEnterpriseStatusLabel("UNKNOWN")).toBe("未知");
    expect(formatEnterpriseRuntimeLabel("UNKNOWN")).toBe("未知");
  });

  it("counts idle seats from total minus occupied", () => {
    expect(resolveIdleSeatCount(10, 7)).toBe(3);
    expect(resolveIdleSeatCount(4, 9)).toBe(0);
  });
});

describe("shared counts", () => {
  it("prefers a populated roster over an empty allocation", () => {
    expect(
      resolveAssignedSeatCount({
        allocationSeats: [],
        rosterSeats: Array.from({ length: 11 }, (_, index) => ({ userId: `user-${index}` })),
      }),
    ).toBe(11);
  });

  it("treats connected sources as healthy", () => {
    expect(normalizeDataSourceHealthStatus("connected")).toBe("normal");
    expect(isDataSourceHealthyStatus("connected")).toBe(true);
    expect(isDataSourceHealthyStatus("disconnected")).toBe(false);
  });
});
