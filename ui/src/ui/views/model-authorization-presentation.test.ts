import { describe, expect, it } from "vitest";
import {
  buildAuthorizedModelCatalog,
  describeUnavailableModelGrants,
  modelAuthorizationSubjectHeadline,
  presentAuthorizedModel,
} from "./model-authorization-presentation.ts";

describe("presentAuthorizedModel", () => {
  it("distinguishes the same capability from platform and enterprise sources", () => {
    const catalog = buildAuthorizedModelCatalog({
      connections: [{ connectionId: "conn-radeon", displayName: "AMD Radeon Cloud" }],
      assets: [
        {
          runtimeModelId: "ent/cea43bf898/deepseek-v4-flash",
          upstreamModelId: "deepseek-v4-flash",
          displayName: "deepseek-v4-flash",
          connectionId: "conn-radeon",
        },
      ],
    });
    const platform = presentAuthorizedModel("api-proxy-deepseek/deepseek-v4-flash", catalog);
    const enterprise = presentAuthorizedModel("ent/cea43bf898/deepseek-v4-flash", catalog);
    const otherEnterprise = presentAuthorizedModel("ent/d590881797/deepseek-v4-flash", catalog);

    expect(platform).toMatchObject({
      title: "Deepseek V4 Flash",
      sourceKind: "platform",
      badge: "平台提供 · api-proxy-deepseek",
    });
    expect(enterprise).toMatchObject({
      title: "Deepseek V4 Flash",
      sourceKind: "enterprise",
      badge: "企业自供 · AMD Radeon Cloud",
    });
    expect(otherEnterprise.badge).toBe("企业自供 · d590881797");
    expect(platform.badge).not.toBe(enterprise.badge);
    expect(enterprise.badge).not.toBe(otherEnterprise.badge);
  });

  it("keeps a friendly asset display name", () => {
    const catalog = buildAuthorizedModelCatalog({
      assets: [
        {
          runtimeModelId: "ent/abc123def4/qwen3",
          upstreamModelId: "qwen3",
          displayName: "通义千问 3",
          connectionName: "内网推理",
        },
      ],
    });
    expect(presentAuthorizedModel("ent/abc123def4/qwen3", catalog)).toMatchObject({
      title: "通义千问 3",
      badge: "企业自供 · 内网推理",
    });
  });
});

describe("describeUnavailableModelGrants", () => {
  it("separates deleted enterprise assets from models still outside the ceiling", () => {
    const catalog = buildAuthorizedModelCatalog({
      assets: [
        {
          runtimeModelId: "ent/1b45c754c9/coder390-27b-int8",
          connectionName: "网域星辰",
        },
      ],
    });
    const text = describeUnavailableModelGrants({
      modelIds: [
        "ent/cc41dd5419/mimo-v2.6-flash",
        "ent/1b45c754c9/coder390-27b-int8",
        "ent/cea43bf898/deepseek-v4-flash",
      ],
      catalog,
    });
    expect(text).toContain("不能授权：ent/1b45c754c9/coder390-27b-int8");
    expect(text).toContain(
      "已不在模型库，不能授权（取消勾选即可移除）：ent/cc41dd5419/mimo-v2.6-flash, ent/cea43bf898/deepseek-v4-flash",
    );
  });
});

describe("modelAuthorizationSubjectHeadline", () => {
  it("uses occupant and job, and keeps the uuid in the tooltip", () => {
    const headline = modelAuthorizationSubjectHeadline({
      label: "View Collage",
      meta: "CEO",
      subjectType: "seat",
      subjectId: "fa5faa84-726d-452e-bcdf-f18358bc84ec",
      roleLabel: "TEAM-L1-001",
    });
    expect(headline.title).toBe("View Collage · CEO");
    expect(headline.title).not.toContain("fa5faa84");
    expect(headline.tooltip).toContain("fa5faa84-726d-452e-bcdf-f18358bc84ec");
    expect(headline.tooltip).toContain("TEAM-L1-001");
  });

  it("does not promote an opaque id into the title", () => {
    const headline = modelAuthorizationSubjectHeadline({
      label: "席位 · fa5faa84-726d-452e-bcdf-f18358bc84ec",
      meta: "已有授权",
      subjectType: "seat",
      subjectId: "fa5faa84-726d-452e-bcdf-f18358bc84ec",
    });
    expect(headline.title).toBe("席位");
    expect(headline.tooltip).toBe("fa5faa84-726d-452e-bcdf-f18358bc84ec");
  });
});
