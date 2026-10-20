// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createOpenClawTools } from "../openclaw-tools.js";
import { createDataCapabilityTool } from "./data-capability-tool.js";

vi.mock("../../gateway/enterprise-data/capability-agent-invoke-runtime.js", () => ({
  listDataCapabilitiesForAgent: vi.fn(async () => ({
    ok: true,
    tenantId: "tenant-acme",
    seatId: "seat-sales-mgr-east",
    capabilities: [
      {
        capabilityId: "cap-customer",
        title: "客户画像",
        summary: "客户主数据摘要",
        sourceSystems: ["Salesforce"],
        accessState: "granted" as const,
      },
      {
        capabilityId: "cap-churn",
        title: "流失风险",
        summary: "流失风险洞察",
        sourceSystems: ["CRM"],
        accessState: "requestable" as const,
      },
    ],
  })),
  invokeDataCapabilityForAgent: vi.fn(async (params: { capabilityId: string }) => ({
    ok: true,
    capabilityId: params.capabilityId,
    accessState: "granted" as const,
    title: "客户画像",
    results: [
      {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
        ok: true,
        data: { customer: { id: "cust-001" } },
        recordCount: 1,
        scopeApplied: "SELF",
        maskedFields: ["customer.phone"],
        traceId: "trace-test-1",
      },
    ],
    auditId: "audit-test-1",
  })),
}));

describe("data_capability agent tool", () => {
  it("is registered on the standard agent tool set", () => {
    const tools = createOpenClawTools();
    const tool = tools.find((candidate) => candidate.name === "data_capability");
    expect(tool).toBeTruthy();
    expect(tool?.label).toBe("Data Capability");
    expect(tool?.parameters).toBeTruthy();
  });

  it("rejects when no signed-in enterprise session is available", async () => {
    const tool = createDataCapabilityTool();
    await expect(tool.execute("dc-1", { action: "list" } as never)).rejects.toThrow(
      /Signed-in enterprise session is required/i,
    );
  });

  it("lists capabilities when only a platform user id is present", async () => {
    const tool = createDataCapabilityTool({
      gatewayClientPlatformUserId: "user-from-socket",
      gatewayClientSessionDomain: {
        tenantId: "tenant-acme",
      } as never,
    });
    const result = await tool.execute("dc-platform", { action: "list" } as never);
    const body = result.details as { ok: boolean; tenantId?: string };
    expect(body.ok).toBe(true);
    expect(body.tenantId).toBe("tenant-acme");
  });

  it("rejects invalid action values", async () => {
    const tool = createDataCapabilityTool({
      gatewayClientUser: "emp-mgr-001",
    });
    await expect(tool.execute("dc-2", { action: "delete" } as never)).rejects.toThrow(
      /action must be one of: list, invoke/i,
    );
  });

  it("lists governed capabilities for a signed-in session", async () => {
    const tool = createDataCapabilityTool({
      gatewayClientUser: "emp-mgr-001",
      gatewayClientSessionDomain: {
        tenantId: "tenant-acme",
      } as never,
    });
    const result = await tool.execute("dc-3", { action: "list" } as never);
    const body = result.details as {
      ok: boolean;
      tenantId?: string;
      seatId?: string;
      capabilities: Array<{ capabilityId: string; accessState: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.tenantId).toBe("tenant-acme");
    expect(body.seatId).toBe("seat-sales-mgr-east");
    expect(body.capabilities).toHaveLength(2);
    expect(body.capabilities[0]?.capabilityId).toBe("cap-customer");
    expect(body.capabilities[0]?.accessState).toBe("granted");
    expect(body.capabilities[1]?.accessState).toBe("requestable");
  });

  it("fail-closes invoke without requesting a connector action", async () => {
    const runtime =
      await import("../../gateway/enterprise-data/capability-agent-invoke-runtime.js");
    const tool = createDataCapabilityTool({
      gatewayClientUser: "emp-mgr-001",
      requesterAgentIdOverride: "agent-sales",
      agentSessionKey: "agent:agent-sales:main",
    });
    const result = await tool.execute("dc-4", {
      action: "invoke",
      capabilityId: "cap-customer",
      input: { customerId: "cust-001" },
    } as never);
    const body = result.details as {
      ok: boolean;
      capabilityId: string;
      reason?: string;
      results?: unknown[];
    };
    expect(body.ok).toBe(false);
    expect(body.capabilityId).toBe("cap-customer");
    expect(body.reason).toBe("knowledge-object-only");
    expect(body.results).toBeUndefined();
    expect(runtime.invokeDataCapabilityForAgent).not.toHaveBeenCalled();
  });

  it("requires capabilityId for invoke", async () => {
    const tool = createDataCapabilityTool({
      gatewayClientUser: "emp-mgr-001",
    });
    await expect(tool.execute("dc-5", { action: "invoke" } as never)).rejects.toThrow(
      /capabilityId/i,
    );
  });
});
