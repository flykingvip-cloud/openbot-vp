import { describe, expect, it } from "vitest";
import { buildEnterpriseModelKeyRows } from "./enterprise-model-key-table.ts";

describe("buildEnterpriseModelKeyRows", () => {
  it("gives every platform and enterprise model a seat-config entry", () => {
    const rows = buildEnterpriseModelKeyRows({
      catalogModelIds: ["live-provider/vision-model", "removed-looking/still-configured"],
      connections: [
        {
          connectionId: "conn-1",
          displayName: "内网推理",
          providerType: "openai-compatible",
          baseUrl: "http://10.0.0.8:8000/v1",
          status: "verified",
        },
      ],
      assets: [
        {
          runtimeModelId: "ent/conn1/qwen",
          upstreamModelId: "qwen",
          displayName: "通义",
          connectionId: "conn-1",
          connectionName: "内网推理",
        },
      ],
    });

    expect(rows.map((row) => row.supply)).toEqual(["platform", "platform", "enterprise"]);
    expect(rows.every((row) => row.seatConfigurable)).toBe(true);
    const platform = rows.find((row) => row.modelId === "live-provider/vision-model");
    const enterprise = rows.find((row) => row.modelId === "ent/conn1/qwen");
    expect(platform).toMatchObject({
      supplyLabel: "平台提供",
      configEditable: false,
      configSummary: "套餐下发 · 只读",
    });
    expect(enterprise).toMatchObject({
      supplyLabel: "企业自供",
      configEditable: true,
      title: "通义",
      connectionId: "conn-1",
    });
    expect(enterprise?.configSummary).toContain("已连通");
    expect(enterprise?.configSummary).toContain("http://10.0.0.8:8000/v1");
  });
});
