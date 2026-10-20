import { beforeEach, describe, expect, it, vi } from "vitest";

const { configSaveMock, loadModelsManagementSnapshotMock, updateFormValueMock, runUpdateMock } =
  vi.hoisted(() => ({
    configSaveMock: vi.fn(async (state: { configFormDirty: boolean }) => {
      state.configFormDirty = false;
    }),
    loadModelsManagementSnapshotMock: vi.fn(async () => {}),
    updateFormValueMock: vi.fn(),
    runUpdateMock: vi.fn(async () => {}),
  }));

vi.mock("../../capability/config/index.ts", () => ({
  configCapability: {
    save: configSaveMock,
    updateFormValue: updateFormValueMock,
    removeFormValue: vi.fn(),
    runUpdate: runUpdateMock,
  },
}));

vi.mock("../../controllers/platform-models-management.ts", () => ({
  loadPlatformModelsManagementSnapshot: loadModelsManagementSnapshotMock,
}));

import { createPlatformPortActions } from "./render-actions.ts";

describe("platform render actions", () => {
  beforeEach(() => {
    configSaveMock.mockClear();
    loadModelsManagementSnapshotMock.mockClear();
    updateFormValueMock.mockClear();
    runUpdateMock.mockClear();
  });

  it("runs gateway self-update via systemSettings.onRunUpdate (Phase 1b)", () => {
    const actionState = { loadOverview: vi.fn(async () => {}), platformAuthState: null } as never;
    const capabilityState = { channels: {}, config: {} } as never;
    const actions = createPlatformPortActions({ actionState, capabilityState });

    void actions.systemSettings.onRunUpdate();

    expect(runUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("reloads overview and models management snapshot after a successful system-settings save", async () => {
    const loadOverview = vi.fn(async () => {});
    const actionState = {
      loadOverview,
      platformAuthState: null,
    } as never;
    const capabilityState = {
      channels: {},
      config: {
        configFormDirty: true,
      },
    } as never;

    const actions = createPlatformPortActions({
      actionState,
      capabilityState,
    });

    await actions.systemSettings.onSaveConfig();

    expect(configSaveMock).toHaveBeenCalledTimes(1);
    expect(loadOverview).toHaveBeenCalledTimes(1);
    expect(loadModelsManagementSnapshotMock).toHaveBeenCalledWith(actionState);
  });

  describe("provider apiKey wiring (Phase 1)", () => {
    const REDACTED = "__OPENCLAW_REDACTED__";

    function setup() {
      const actionState = { loadOverview: vi.fn(async () => {}), platformAuthState: null } as never;
      const capabilityState = {
        channels: {},
        config: {
          configForm: {
            models: {
              providers: {
                p1: {
                  baseUrl: "https://api.example.com/v1",
                  api: "openai-completions",
                  apiKey: REDACTED,
                  models: [],
                },
              },
            },
          },
        },
      } as never;
      const actions = createPlatformPortActions({ actionState, capabilityState });
      return { actions };
    }

    function lastProviderWrite() {
      const call = [...updateFormValueMock.mock.calls].toReversed().find((entry) => {
        const path = entry[1];
        return Array.isArray(path) && path[0] === "models" && path[1] === "providers";
      });
      return {
        path: call?.[1] as Array<string | number>,
        value: call?.[2] as Record<string, unknown>,
      };
    }

    it("writes a new apiKey when provided on provider update", () => {
      const { actions } = setup();
      actions.models.onUpdateProvider({
        providerId: "p1",
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        auth: "api-key",
        apiKey: "sk-new-key",
      });
      const { path, value } = lastProviderWrite();
      expect(path).toEqual(["models", "providers", "p1"]);
      expect(value.apiKey).toBe("sk-new-key");
    });

    it("preserves the existing (redacted) key when apiKey left empty", () => {
      const { actions } = setup();
      actions.models.onUpdateProvider({
        providerId: "p1",
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        auth: "api-key",
        apiKey: "",
      });
      const { value } = lastProviderWrite();
      // No new key written; the spread of the existing provider keeps the
      // redaction sentinel, which the gateway restores to the stored key.
      expect(value.apiKey).toBe(REDACTED);
    });

    it("sets apiKey on add-model when provided", () => {
      const { actions } = setup();
      actions.models.onAddModel({
        providerId: "p2",
        baseUrl: "https://api.new.com/v1",
        modelId: "m1",
        name: "M1",
        api: "openai-completions",
        contextWindow: 128000,
        maxTokens: 8192,
        inputModes: ["text"],
        reasoning: false,
        apiKey: "sk-add-key",
      });
      const { value } = lastProviderWrite();
      expect(value.apiKey).toBe("sk-add-key");
    });
  });
});
