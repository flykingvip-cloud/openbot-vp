import type { GatewayBrowserClient } from "../gateway.ts";
import { sanitizeEmployeeSkillProfile, type EmployeeSkillProfile } from "./skill-models.ts";

export type ExtractedSkillPreview = {
  suggestedName: string;
  suggestedSummary: string;
  confidence: number;
  detectedAt: number | null;
};

export type QuickSaveSkillFormData = {
  name: string;
  summary: string;
  /** 仅内部兼容；类型由后台创建时自动识别，不向用户展示或提交。 */
  assetType?: EmployeeSkillProfile["assetType"];
};

export type SkillSaveFormData = QuickSaveSkillFormData;

export type SkillLifecycleState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  saveModalOpen: boolean;
  saveModalBusy: boolean;
  saveModalError: string | null;
  saveModalFormData: QuickSaveSkillFormData | null;
  extractedPreview: ExtractedSkillPreview | null;
  sourceAgentId: string | null;
  sourceContextId: string | null;
};

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePreview(value: unknown): ExtractedSkillPreview {
  const record = asRecord(value) ?? {};
  const profile = sanitizeEmployeeSkillProfile(record.profile);
  return {
    suggestedName: typeof record.suggestedName === "string" ? record.suggestedName : profile.name,
    suggestedSummary:
      typeof record.suggestedSummary === "string" ? record.suggestedSummary : profile.summary,
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0,
    detectedAt: numberOrNull(record.detectedAt),
  };
}

function createDefaultForm(preview: ExtractedSkillPreview | null = null): QuickSaveSkillFormData {
  return {
    name: preview?.suggestedName.trim() ?? "",
    summary: preview?.suggestedSummary.trim() ?? "",
  };
}

export async function extractSkillContent(
  state: SkillLifecycleState,
  agentId: string,
  contextId: string,
): Promise<void> {
  state.sourceAgentId = agentId;
  state.sourceContextId = contextId;
  state.saveModalError = null;
  if (!state.client || !state.connected) {
    return;
  }

  try {
    const result = await state.client.request("skill-lifecycle.extract", { agentId, contextId });
    state.extractedPreview = normalizePreview(result);
    state.saveModalFormData = createDefaultForm(state.extractedPreview);
  } catch (err) {
    state.saveModalError = getErrorMessage(err);
  }
}

export async function saveSkill(
  state: SkillLifecycleState,
  formData: QuickSaveSkillFormData,
  sourceAgentId: string,
): Promise<{ skillId: string } | null> {
  const name = formData.name.trim();
  const summary = formData.summary.trim();
  if (!name || !summary) {
    state.saveModalError = "请填写技能名称和一句话描述";
    state.saveModalFormData = { ...formData, name, summary };
    return null;
  }
  if (!state.client || !state.connected) {
    return null;
  }

  state.saveModalBusy = true;
  state.saveModalError = null;
  state.saveModalFormData = { ...formData, name, summary };
  try {
    const profile: Omit<EmployeeSkillProfile, "id" | "assetType"> = {
      name,
      summary,
      usageExamples: [],
      inputDescription: "",
      outputDescription: "",
      tags: [],
      category: "",
      avatar: "",
      visibility: "private",
    };
    const result = await state.client.request<{ skillId?: string }>("skill-lifecycle.save", {
      sourceAgentId,
      contextId: state.sourceContextId,
      lifecycle: "draft",
      profile,
    });
    const skillId = result?.skillId?.trim();
    if (!skillId) {
      state.saveModalError = "技能已保存，但未返回技能编号";
      return null;
    }
    state.saveModalOpen = false;
    return { skillId };
  } catch (err) {
    state.saveModalError = getErrorMessage(err);
    return null;
  } finally {
    state.saveModalBusy = false;
  }
}

export function openSaveModal(state: SkillLifecycleState, agentId: string): void {
  state.sourceAgentId = agentId;
  state.saveModalOpen = true;
  state.saveModalError = null;
  state.saveModalFormData = state.saveModalFormData ?? createDefaultForm(state.extractedPreview);
}

export function closeSaveModal(state: SkillLifecycleState): void {
  state.saveModalOpen = false;
  state.saveModalError = null;
}
