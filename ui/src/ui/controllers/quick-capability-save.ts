import type { QuickSavePatternHint } from "../capability/employee-capability/endpoints.ts";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import type {
  CapabilitySummary,
  QuickCapabilitySaveFormData,
} from "../capability/employee-capability/types.ts";

export type QuickCapabilitySaveState = {
  gateway: EmployeeCapabilityGateway | null;
  open: boolean;
  busy: boolean;
  error: string | null;
  formData: QuickCapabilitySaveFormData;
  sourceAgentId: string | null;
  sourceContextId: string | null;
  patternHint: QuickSavePatternHint | null;
  savedCapability: CapabilitySummary | null;
};

export function createInitialQuickCapabilitySaveState(): QuickCapabilitySaveState {
  return {
    gateway: null,
    open: false,
    busy: false,
    error: null,
    formData: { name: "", summary: "" },
    sourceAgentId: null,
    sourceContextId: null,
    patternHint: null,
    savedCapability: null,
  };
}

export function openQuickSave(
  state: QuickCapabilitySaveState,
  params: {
    sourceAgentId: string;
    sourceContextId: string;
    patternHint?: QuickSavePatternHint | null;
    initialForm?: Partial<QuickCapabilitySaveFormData>;
  },
): void {
  state.open = true;
  state.error = null;
  state.savedCapability = null;
  state.sourceAgentId = params.sourceAgentId;
  state.sourceContextId = params.sourceContextId;
  state.patternHint = params.patternHint ?? null;
  state.formData = {
    name: params.initialForm?.name ?? "",
    summary: params.initialForm?.summary ?? "",
  };
}

export function closeQuickSave(state: QuickCapabilitySaveState): void {
  state.open = false;
  state.error = null;
  state.busy = false;
}

export function updateQuickSaveForm(
  state: QuickCapabilitySaveState,
  patch: Partial<QuickCapabilitySaveFormData>,
): void {
  state.formData = {
    ...state.formData,
    ...patch,
  };
}

function validateQuickSave(state: QuickCapabilitySaveState): string | null {
  if (!state.gateway) {
    return "暂时无法保存，请稍后再试";
  }
  if (!state.sourceAgentId || !state.sourceContextId) {
    return "请从有效的机器人工作中保存能力";
  }
  if (!state.formData.name.trim()) {
    return "请填写名称";
  }
  if (!state.formData.summary.trim()) {
    return "请填写一句话描述";
  }
  return null;
}

export async function submitQuickSave(
  state: QuickCapabilitySaveState,
): Promise<CapabilitySummary | null> {
  const validationError = validateQuickSave(state);
  if (validationError) {
    state.error = validationError;
    return null;
  }

  state.busy = true;
  state.error = null;
  try {
    const response = await state.gateway!.quickSave({
      name: state.formData.name.trim(),
      summary: state.formData.summary.trim(),
      sourceAgentId: state.sourceAgentId!,
      sourceContextId: state.sourceContextId!,
      patternHint: state.patternHint,
    });
    state.savedCapability = response.capability;
    state.open = false;
    return response.capability;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = `保存失败：${message}`;
    return null;
  } finally {
    state.busy = false;
  }
}
