import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import type { AppPortState } from "../app-port-state.ts";
import { resolvePreviewArtifactRecord } from "../chat/generated-preview-artifact.ts";
import { syncUserInitiatedSave } from "../controllers/asset-incubation/index.ts";
import {
  dismissAssetSuggestion,
  isAssetSuggestionDismissed,
} from "../controllers/asset-incubation/suggestion-dismiss.ts";
import type { AssetIncubationLevel } from "../controllers/asset-incubation/types.ts";
import { ensureAssetSuggestionPatternRuntime } from "../controllers/asset-suggestion-trigger.ts";
import { dismissHint } from "../controllers/pattern-detection.ts";
import {
  extractSkillContent,
  type QuickSaveSkillFormData,
  type SkillLifecycleState,
} from "../controllers/skill-lifecycle.ts";

export type ArtifactPreviewIncubationView = {
  level: AssetIncubationLevel | null;
  reason: string | null;
  showWeakHint: boolean;
  showSystemSuggest: boolean;
  showEnterpriseSubmitAction: boolean;
};

const skillSaveExtractSeqByOwner = new WeakMap<object, number>();

function nextSkillSaveExtractSeq(owner: object): number {
  const next = (skillSaveExtractSeqByOwner.get(owner) ?? 0) + 1;
  skillSaveExtractSeqByOwner.set(owner, next);
  return next;
}

function currentSkillSaveExtractSeq(owner: object): number {
  return skillSaveExtractSeqByOwner.get(owner) ?? 0;
}

function findLatestArtifactId(messages: unknown[]): string | null {
  for (const message of [...messages].toReversed()) {
    const artifact = resolvePreviewArtifactRecord(message);
    const artifactId =
      artifact && typeof artifact.artifactId === "string" ? artifact.artifactId.trim() : "";
    if (artifactId) {
      return artifactId;
    }
  }
  return null;
}

function shouldRecommendEnterpriseSubmissionFromSuggestion(params: {
  source: AppPortState["workbenchAssetSuggestionSource"];
  label: string | null | undefined;
  hint: string | null | undefined;
}): boolean {
  const text = [params.label ?? "", params.hint ?? ""].join(" ").toLowerCase();
  let score = 0;
  if (params.source === "manual-iteration") {
    score += 1;
  }
  if (/(公众号|发布|公开|外部|草稿箱|群发|material|media_id)/i.test(text)) {
    score += 2;
  }
  if (/(脚本|流程|接口|api|上传|素材|工作流|资产包|凭证|密钥|审核|预览)/i.test(text)) {
    score += 2;
  }
  return score >= 3;
}

export function resolveArtifactPreviewIncubationView(
  state: AppPortState,
): ArtifactPreviewIncubationView {
  const level = state.workbenchAssetIncubationLevel ?? null;
  const reason =
    state.workbenchAssetIncubationDecision?.reason?.trim() ||
    state.workbenchAssetSuggestionLabel?.trim() ||
    null;
  const depositHint =
    reason ??
    (state.workbenchSkillSourceAgentId
      ? `可从当前工作沉淀，来源：${state.workbenchSkillSourceAgentId}`
      : "已识别当前工作上下文，可直接沉淀能力");
  const contextId =
    state.workbenchSkillSourceContextId ??
    findLatestArtifactId(state.chatMessages ?? []) ??
    state.sessionKey ??
    null;
  const dismissed = isAssetSuggestionDismissed({
    contextId,
    sessionKey: state.sessionKey,
  });
  const showSystemSuggest =
    !dismissed &&
    Boolean(state.workbenchAssetSuggestionVisible) &&
    (level === "L3" || level === "L4");
  const showWeakHint =
    !dismissed &&
    Boolean(state.workbenchAssetWeakHintVisible) &&
    !state.workbenchAssetSuggestionVisible &&
    level === "L2";
  const showEnterpriseSubmitAction = shouldRecommendEnterpriseSubmissionFromSuggestion({
    source: state.workbenchAssetSuggestionSource,
    label: state.workbenchAssetSuggestionLabel,
    hint: depositHint,
  });
  return {
    level,
    reason: depositHint,
    showWeakHint,
    showSystemSuggest,
    showEnterpriseSubmitAction,
  };
}

function createSkillLifecycleDraftState(state: AppPortState): SkillLifecycleState {
  return {
    client: state.client,
    connected: state.connected,
    saveModalOpen: state.workbenchSkillSaveModalOpen ?? false,
    saveModalBusy: state.workbenchSkillSaveModalBusy ?? false,
    saveModalError: state.workbenchSkillSaveModalError ?? null,
    saveModalFormData: state.workbenchSkillSaveModalFormData ?? null,
    extractedPreview: state.workbenchSkillExtractedPreview ?? null,
    sourceAgentId: state.workbenchSkillSourceAgentId ?? null,
    sourceContextId: state.workbenchSkillSourceContextId ?? null,
  };
}

export function dismissAssetIncubationFromPreview(
  state: AppPortState,
  requestRender: () => void,
): void {
  nextSkillSaveExtractSeq(state);
  const contextId =
    state.workbenchSkillSourceContextId ??
    findLatestArtifactId(state.chatMessages ?? []) ??
    state.sessionKey ??
    null;
  dismissAssetSuggestion({
    contextId,
    sessionKey: state.sessionKey,
  });
  if (contextId) {
    const runtime = ensureAssetSuggestionPatternRuntime(
      state,
      state.client ?? null,
      Boolean(state.connected),
    );
    dismissHint(runtime.state, contextId);
  }
  state.workbenchAssetSuggestionVisible = false;
  state.workbenchAssetWeakHintVisible = false;
  requestRender();
}

export function openSkillSaveFromPreview(
  state: AppPortState,
  preferEnterpriseSubmit: boolean,
  requestRender: () => void,
  prefill?: Partial<QuickSaveSkillFormData>,
): void {
  state.workbenchAssetSuggestionVisible = false;
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.assistantAgentId ?? "main";
  const contextId = findLatestArtifactId(state.chatMessages ?? []) || state.sessionKey || null;
  state.workbenchSkillSourceAgentId = agentId;
  state.workbenchSkillSourceContextId = contextId;
  const level = state.workbenchAssetIncubationLevel;
  const preferEnterprise = preferEnterpriseSubmit || level === "L4";
  void syncUserInitiatedSave(state.client, { contextId });
  const extractSeq = nextSkillSaveExtractSeq(state);
  state.workbenchSkillSaveModalOpen = true;
  state.workbenchSkillSaveModalError = null;
  state.workbenchSkillSavePreferEnterpriseSubmit = preferEnterprise;
  state.workbenchSkillSaveModalFormData = {
    name: prefill?.name ?? "",
    summary: prefill?.summary ?? "",
    assetType: prefill?.assetType ?? (preferEnterpriseSubmit ? "workflow" : "capability"),
  };
  requestRender();
  const draft = createSkillLifecycleDraftState(state);
  void extractSkillContent(draft, agentId, state.workbenchSkillSourceContextId ?? "").then(() => {
    if (currentSkillSaveExtractSeq(state) !== extractSeq || !state.workbenchSkillSaveModalOpen) {
      return;
    }
    state.workbenchSkillExtractedPreview = draft.extractedPreview;
    state.workbenchSkillSaveModalError = draft.saveModalError;
    if (draft.saveModalFormData) {
      state.workbenchSkillSaveModalFormData = draft.saveModalFormData;
    }
    if (
      preferEnterpriseSubmit &&
      state.workbenchSkillSaveModalFormData?.assetType === "capability"
    ) {
      state.workbenchSkillSaveModalFormData = {
        ...state.workbenchSkillSaveModalFormData,
        assetType: "workflow",
      };
    }
    requestRender();
  });
}
