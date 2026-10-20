import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import {
  clearAssetSuggestionDismissalsForTests,
  dismissAssetSuggestion,
} from "../controllers/asset-incubation/suggestion-dismiss.ts";
import {
  dismissAssetIncubationFromPreview,
  resolveArtifactPreviewIncubationView,
} from "./asset-incubation-preview.ts";

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    sessionKey: "agent:main:main",
    chatMessages: [],
    workbenchAssetSuggestionVisible: true,
    workbenchAssetSuggestionSource: "assistant-task-complete",
    workbenchAssetSuggestionLabel: "这次机器人任务已完成，系统建议整理其中可复用的资产。",
    workbenchAssetIncubationLevel: "L3",
    workbenchAssetIncubationDecision: {
      level: "L3",
      score: 0.82,
      reason: "已重复出现稳定产出结构",
      evidence: {
        recurrenceCount: 3,
        sessionQuality: 0.8,
        userInitiatedSaveCount: 0,
        externalizationCount: 0,
        collaborationReuseCount: 0,
        editPatternStabilityCount: 0,
        reviewEngineStableCluster: false,
        adoption: {
          distinctMemberCount: 0,
          sharedToGroup: false,
          adminRecommended: false,
          enterpriseSubmitted: false,
        },
      },
      signalTrace: [],
      source: "session-detector",
      contextId: "artifact-1",
    },
    workbenchAssetWeakHintVisible: false,
    workbenchSkillSourceContextId: "artifact-1",
    workbenchSkillSourceAgentId: "main",
    client: null,
    connected: true,
    ...overrides,
  } as AppPortState;
}

describe("asset-incubation-preview wiring", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    clearAssetSuggestionDismissalsForTests();
    vi.unstubAllGlobals();
  });

  it("surfaces L3 system suggest in the preview view model", () => {
    const view = resolveArtifactPreviewIncubationView(createState());
    expect(view.showSystemSuggest).toBe(true);
    expect(view.showWeakHint).toBe(false);
    expect(view.level).toBe("L3");
  });

  it("hides preview incubation after dismiss", () => {
    const state = createState();
    dismissAssetSuggestion({
      contextId: "artifact-1",
      sessionKey: "agent:main:main",
    });
    const view = resolveArtifactPreviewIncubationView(state);
    expect(view.showSystemSuggest).toBe(false);
    expect(view.showWeakHint).toBe(false);
  });

  it("dismissAssetIncubationFromPreview clears suggestion flags", () => {
    const state = createState({
      workbenchAssetWeakHintVisible: true,
      workbenchAssetSuggestionVisible: true,
    });
    const requestRender = vi.fn();
    dismissAssetIncubationFromPreview(state, requestRender);
    expect(state.workbenchAssetSuggestionVisible).toBe(false);
    expect(state.workbenchAssetWeakHintVisible).toBe(false);
    expect(requestRender).toHaveBeenCalled();
    expect(resolveArtifactPreviewIncubationView(state).showSystemSuggest).toBe(false);
  });
});
