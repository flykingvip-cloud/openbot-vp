// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildEnterprisePortReadModel } from "./enterprise-read-model.ts";

describe("enterprise-read-model model object parsing", () => {
  it("counts object-form models and builds provider/model ids", () => {
    const state = {
      hello: null,
      platformAuthState: {
        tenantName: "Acme",
        membershipRole: "enterprise-admin",
        members: [],
      },
      bootstrapAuthSession: null,
      settings: { recentEnterpriseTenantIds: [] },
      agentsList: { defaultId: "main", agents: [] },
      presenceEntries: [],
      sessionsResult: { count: 0, sessions: [] },
      nodes: [],
      cronJobs: [],
      usageResult: null,
      channelsSnapshot: null,
      configIssues: [],
    };
    const readModel = buildEnterprisePortReadModel(
      state as never,
      {
        models: {
          providers: {
            openai: {
              models: [{ id: "gpt-5", name: "GPT-5" }, "legacy-string"],
            },
          },
        },
      },
      "tenant-1",
    );
    expect(readModel.configuredModelCount).toBe(2);
    expect(readModel.configuredModelIds).toEqual(["openai/gpt-5", "openai/legacy-string"]);
  });
});
