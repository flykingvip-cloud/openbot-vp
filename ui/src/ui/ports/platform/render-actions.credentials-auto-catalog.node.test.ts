// @vitest-environment node
// Feature: model-entitlement-chain — 平台端「控制台配 key 即自动生效」(Plan 1)。
// 管理员在控制台保存 provider key 时，同一次配置写入里自动置
// gateway.platform.models.credentials.mode="catalog"，让刚配置的内联 key 成为运行时权威来源
// （配合 model-auth 的解析顺序：catalog 优先于残留 auth-profile / 失效 env），无需手动开开关。
import { describe, expect, it } from "vitest";
import { createPlatformPortActions, type CreatePlatformPortActionsArgs } from "./render-actions.js";

type ConfigFormShape = {
  models?: { providers?: Record<string, { apiKey?: string; baseUrl?: string }> };
  gateway?: { platform?: { models?: { credentials?: { mode?: string } } } };
};

function makeActions() {
  const configState = {
    configForm: {} as Record<string, unknown>,
    configSnapshot: { config: {} },
    configFormDirty: false,
    // 非 "form" 模式：跳过表单序列化副作用，测试只关心 configForm 结构。
    configFormMode: "raw",
    configRaw: "",
  };
  const args = {
    actionState: {},
    capabilityState: { config: configState },
  } as unknown as CreatePlatformPortActionsArgs;
  const actions = createPlatformPortActions(args);
  return { actions, configState };
}

describe("createPlatformPortActions — 平台端配 key 自动启用 catalog (Plan 1)", () => {
  it("onUpdateProvider 带 apiKey：同时写入 provider 与 credentials.mode=catalog", () => {
    const { actions, configState } = makeActions();
    actions.models.onUpdateProvider({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      auth: "api-key",
      apiKey: "sk-deepseek-x",
    });
    const form = configState.configForm as ConfigFormShape;
    expect(form.models?.providers?.deepseek?.apiKey).toBe("sk-deepseek-x");
    expect(form.gateway?.platform?.models?.credentials?.mode).toBe("catalog");
  });

  it("onUpdateProvider 不带 apiKey：不触发 catalog 写入（保留现有 key/模式）", () => {
    const { actions, configState } = makeActions();
    actions.models.onUpdateProvider({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      auth: "api-key",
      apiKey: "",
    });
    const form = configState.configForm as ConfigFormShape;
    expect(form.models?.providers?.deepseek?.baseUrl).toBe("https://api.deepseek.com/v1");
    // 未配 key → 不应写入 credentials.mode。
    expect(form.gateway).toBeUndefined();
  });

  it("onAddModel 带 apiKey：新增模型的同时也启用 catalog 模式", () => {
    const { actions, configState } = makeActions();
    actions.models.onAddModel({
      providerId: "deepseek",
      modelId: "deepseek-chat",
      name: "DeepSeek Chat",
      api: "openai-completions",
      reasoning: false,
      inputModes: ["text"],
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-deepseek-y",
      contextWindow: 128000,
      maxTokens: 8192,
    });
    const form = configState.configForm as ConfigFormShape;
    expect(form.models?.providers?.deepseek?.apiKey).toBe("sk-deepseek-y");
    expect(form.gateway?.platform?.models?.credentials?.mode).toBe("catalog");
  });
});
