import type { AppPortState } from "../../app-port-state.ts";
import { resolveWorkbenchDataSpaceSettings } from "./data-space.ts";
import type {
  MemoryCenterAtomRow,
  MemoryCenterEntryRow,
  MemoryCenterPanelState,
} from "./views/memory-center-page.ts";

/** O4 runtime fields kept off shared shell-slices to avoid multi-stream landings. */
type MemoryCenterO4RuntimeState = AppPortState & {
  workbenchMemoryCenterStatusView?: "active" | "tentative";
  workbenchMemoryCenterOtherViewTotal?: number;
  workbenchMemoryCenterAtomListError?: { code: string; message: string } | null;
};

function asO4State(state: AppPortState): MemoryCenterO4RuntimeState {
  return state as MemoryCenterO4RuntimeState;
}

type MemoryListResponse = {
  entries?: Array<{
    key?: string;
    label?: string;
    bytes?: number;
    updatedAtMs?: number;
  }>;
  atoms?: Array<{
    id?: string;
    summary?: string;
    atomType?: string;
    whyHint?: string;
    scope?: {
      kind?: string;
      visibility?: string;
      agentId?: string;
      spaceId?: string;
      groupKey?: string;
    };
    botId?: string;
    privacyLevel?: string;
    syncEligible?: boolean;
    shared?: boolean;
    status?: string;
    updatedAtMs?: number;
    confidence?: number;
  }>;
  viewMode?: "files" | "atoms" | "mixed";
  statusView?: "active" | "tentative";
  atomList?:
    | {
        ok: true;
        statusView: "active" | "tentative";
        total: number;
        truncated: boolean;
        otherViewTotal?: number;
      }
    | {
        ok: false;
        statusView: "active" | "tentative";
        code: string;
        message: string;
      };
};

function friendlyMemoryCenterError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/unknown method:\s*data\.memory/i.test(raw)) {
    return "记忆中心需要更新版本的网关。请重启 OpenBot 网关后重试。";
  }
  if (/LOCAL_ONLY|managed/i.test(raw)) {
    return "当前为云端托管模式，本地记忆中心不可用。";
  }
  if (/MEMORY_SUBJECT_UNBOUND/i.test(raw)) {
    return "当前机器人尚未绑定记忆主体，无法列出记忆要点。";
  }
  if (/MEMORY_SUBJECT_OWNER_MISMATCH|MEMORY_SUBJECT_TENANT_MISMATCH/i.test(raw)) {
    return "无权查看该机器人的记忆要点。";
  }
  return raw;
}

function friendlyAtomListError(code: string, message: string): { code: string; message: string } {
  if (code === "MEMORY_SUBJECT_UNBOUND") {
    return { code, message: "当前机器人尚未绑定记忆主体，无法列出记忆要点。" };
  }
  if (code === "MEMORY_SUBJECT_OWNER_MISMATCH" || code === "MEMORY_SUBJECT_TENANT_MISMATCH") {
    return { code, message: "无权查看该机器人的记忆要点。" };
  }
  return { code, message };
}

function parseAtomRow(
  row: NonNullable<MemoryListResponse["atoms"]>[number],
): MemoryCenterAtomRow | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  if (!id || !summary) {
    return null;
  }
  const kind =
    row.scope?.kind === "space" || row.scope?.kind === "group" || row.scope?.kind === "agent"
      ? row.scope.kind
      : "agent";
  const visibility = row.scope?.visibility === "shared" ? "shared" : "private";
  return {
    id,
    summary,
    atomType:
      typeof row.atomType === "string" && row.atomType.trim() ? row.atomType.trim() : "memory",
    ...(typeof row.whyHint === "string" && row.whyHint.trim()
      ? { whyHint: row.whyHint.trim() }
      : {}),
    scope: {
      kind,
      visibility,
      ...(typeof row.scope?.agentId === "string" ? { agentId: row.scope.agentId } : {}),
      ...(typeof row.scope?.spaceId === "string" ? { spaceId: row.scope.spaceId } : {}),
      ...(typeof row.scope?.groupKey === "string" ? { groupKey: row.scope.groupKey } : {}),
    },
    botId: typeof row.botId === "string" && row.botId.trim() ? row.botId.trim() : "shared",
    ...(row.privacyLevel === "private" ||
    row.privacyLevel === "shared" ||
    row.privacyLevel === "org" ||
    row.privacyLevel === "public"
      ? { privacyLevel: row.privacyLevel }
      : {}),
    syncEligible: row.syncEligible === true,
    shared: row.shared === true || visibility === "shared",
    status: typeof row.status === "string" && row.status.trim() ? row.status.trim() : "active",
    updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : 0,
    ...(typeof row.confidence === "number" ? { confidence: row.confidence } : {}),
  };
}

export function buildWorkbenchMemoryCenterPanelState(state: AppPortState): MemoryCenterPanelState {
  const o4 = asO4State(state);
  const dataSpace = resolveWorkbenchDataSpaceSettings({
    config: state.configSnapshot?.config,
    bootstrapMode: state.bootstrapDataSpace?.mode ?? null,
    bootstrapDisplayRoot: state.bootstrapDataSpace?.displayRoot ?? null,
  });
  const mode = state.workbenchMemoryCenterMode ?? dataSpace.mode;
  return {
    loading: state.workbenchMemoryCenterLoading,
    error: state.workbenchMemoryCenterError,
    mode,
    agentId: state.workbenchMemoryCenterAgentId,
    selectedKey: state.workbenchMemoryCenterKey,
    selectedAtomId: state.workbenchMemoryCenterAtomId,
    busy: state.workbenchMemoryCenterBusy,
    message: state.workbenchMemoryCenterMessage,
    entries: state.workbenchMemoryCenterEntries,
    atoms: state.workbenchMemoryCenterAtoms,
    viewMode: state.workbenchMemoryCenterViewMode,
    entriesLoading: state.workbenchMemoryCenterEntriesLoading,
    statusView: o4.workbenchMemoryCenterStatusView ?? "active",
    otherViewTotal: o4.workbenchMemoryCenterOtherViewTotal,
    atomListError: o4.workbenchMemoryCenterAtomListError ?? null,
  };
}

export async function loadWorkbenchMemoryCenterPanel(
  state: AppPortState,
  requestRender: () => void,
): Promise<void> {
  const dataSpace = resolveWorkbenchDataSpaceSettings({
    config: state.configSnapshot?.config,
    bootstrapMode: state.bootstrapDataSpace?.mode ?? null,
    bootstrapDisplayRoot: state.bootstrapDataSpace?.displayRoot ?? null,
  });
  if (dataSpace.mode === "managed") {
    state.workbenchMemoryCenterMode = "managed";
    state.workbenchMemoryCenterLoading = false;
    state.workbenchMemoryCenterError = null;
    state.workbenchMemoryCenterEntries = [];
    state.workbenchMemoryCenterAtoms = [];
    state.workbenchMemoryCenterViewMode = "files";
    requestRender();
    return;
  }
  state.workbenchMemoryCenterMode = "local";
  state.workbenchMemoryCenterLoading = false;
  state.workbenchMemoryCenterError = null;
  const agentId = (state.workbenchMemoryCenterAgentId ?? "").trim();
  if (agentId) {
    await loadWorkbenchMemoryCenterEntries(state, agentId, requestRender);
  } else {
    requestRender();
  }
}

export async function loadWorkbenchMemoryCenterEntries(
  state: AppPortState,
  agentId: string,
  requestRender: () => void,
): Promise<void> {
  const trimmed = agentId.trim();
  if (!trimmed || !state.client || !state.connected) {
    state.workbenchMemoryCenterEntries = [];
    state.workbenchMemoryCenterAtoms = [];
    state.workbenchMemoryCenterViewMode = "files";
    state.workbenchMemoryCenterEntriesLoading = false;
    requestRender();
    return;
  }
  if (state.workbenchMemoryCenterMode === "managed") {
    state.workbenchMemoryCenterEntries = [];
    state.workbenchMemoryCenterAtoms = [];
    state.workbenchMemoryCenterViewMode = "files";
    state.workbenchMemoryCenterEntriesLoading = false;
    requestRender();
    return;
  }
  const o4 = asO4State(state);
  state.workbenchMemoryCenterEntriesLoading = true;
  state.workbenchMemoryCenterError = null;
  requestRender();
  try {
    const statusView = o4.workbenchMemoryCenterStatusView === "tentative" ? "tentative" : "active";
    const result = await state.client.request<MemoryListResponse>("data.memory.list", {
      agentId: trimmed,
      statusView,
    });
    const entries: MemoryCenterEntryRow[] = (result.entries ?? [])
      .map((row) => {
        const key = typeof row.key === "string" ? row.key.trim() : "";
        if (!key) {
          return null;
        }
        return {
          key,
          label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : key,
          bytes: typeof row.bytes === "number" ? row.bytes : 0,
          updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : 0,
        };
      })
      .filter((row): row is MemoryCenterEntryRow => row !== null);
    const atoms = (result.atoms ?? [])
      .map((row) => parseAtomRow(row))
      .filter((row): row is MemoryCenterAtomRow => row !== null);
    state.workbenchMemoryCenterEntries = entries;
    state.workbenchMemoryCenterAtoms = atoms;
    o4.workbenchMemoryCenterStatusView =
      result.statusView === "tentative" || result.atomList?.statusView === "tentative"
        ? "tentative"
        : statusView;
    if (result.atomList && !result.atomList.ok) {
      o4.workbenchMemoryCenterAtomListError = friendlyAtomListError(
        result.atomList.code,
        result.atomList.message,
      );
      o4.workbenchMemoryCenterOtherViewTotal = undefined;
    } else {
      o4.workbenchMemoryCenterAtomListError = null;
      o4.workbenchMemoryCenterOtherViewTotal =
        result.atomList && result.atomList.ok ? result.atomList.otherViewTotal : undefined;
    }
    state.workbenchMemoryCenterViewMode =
      result.viewMode === "atoms" || result.viewMode === "mixed" || result.viewMode === "files"
        ? result.viewMode
        : atoms.length > 0
          ? entries.length > 0
            ? "mixed"
            : "atoms"
          : "files";
    if (
      state.workbenchMemoryCenterKey &&
      !entries.some((entry) => entry.key === state.workbenchMemoryCenterKey)
    ) {
      state.workbenchMemoryCenterKey = "";
    }
    if (
      state.workbenchMemoryCenterAtomId &&
      !atoms.some((atom) => atom.id === state.workbenchMemoryCenterAtomId)
    ) {
      state.workbenchMemoryCenterAtomId = "";
    }
  } catch (error) {
    state.workbenchMemoryCenterEntries = [];
    state.workbenchMemoryCenterAtoms = [];
    state.workbenchMemoryCenterViewMode = "files";
    o4.workbenchMemoryCenterAtomListError = null;
    o4.workbenchMemoryCenterOtherViewTotal = undefined;
    state.workbenchMemoryCenterError = friendlyMemoryCenterError(error);
  } finally {
    state.workbenchMemoryCenterEntriesLoading = false;
    requestRender();
  }
}

export function buildWorkbenchMemoryCenterActionHandlers(
  state: AppPortState,
  requestRender: () => void,
) {
  return {
    onMemoryCenterAgentIdChange: (value: string) => {
      state.workbenchMemoryCenterAgentId = value;
      state.workbenchMemoryCenterKey = "";
      state.workbenchMemoryCenterAtomId = "";
      state.workbenchMemoryCenterMessage = null;
      state.workbenchMemoryCenterError = null;
      requestRender();
      void loadWorkbenchMemoryCenterEntries(state, value, requestRender);
    },
    onMemoryCenterKeyChange: (value: string) => {
      state.workbenchMemoryCenterKey = value;
      state.workbenchMemoryCenterAtomId = "";
      state.workbenchMemoryCenterMessage = null;
      requestRender();
    },
    onMemoryCenterAtomIdChange: (value: string) => {
      state.workbenchMemoryCenterAtomId = value;
      state.workbenchMemoryCenterKey = "";
      state.workbenchMemoryCenterMessage = null;
      requestRender();
    },
    onMemoryCenterStatusViewChange: (value: "active" | "tentative") => {
      const o4 = asO4State(state);
      o4.workbenchMemoryCenterStatusView = value;
      state.workbenchMemoryCenterAtomId = "";
      state.workbenchMemoryCenterMessage = null;
      o4.workbenchMemoryCenterAtomListError = null;
      requestRender();
      const agentId = (state.workbenchMemoryCenterAgentId ?? "").trim();
      if (agentId) {
        void loadWorkbenchMemoryCenterEntries(state, agentId, requestRender);
      }
    },
    onMemoryCenterForget: async () => {
      const agentId = (state.workbenchMemoryCenterAgentId ?? "").trim();
      const memoryKey = (state.workbenchMemoryCenterKey ?? "").trim();
      if (!agentId || !memoryKey) {
        state.workbenchMemoryCenterMessage = "请先选择要删除的记忆文件。";
        requestRender();
        return;
      }
      if (!state.client || !state.connected) {
        state.workbenchMemoryCenterMessage = "当前未连接到网关。";
        requestRender();
        return;
      }
      state.workbenchMemoryCenterBusy = true;
      state.workbenchMemoryCenterMessage = null;
      requestRender();
      try {
        await state.client.request("data.memory.forget", { agentId, memoryKey });
        state.workbenchMemoryCenterMessage = "已删除所选记忆文件";
        state.workbenchMemoryCenterKey = "";
        await loadWorkbenchMemoryCenterEntries(state, agentId, requestRender);
      } catch (error) {
        state.workbenchMemoryCenterMessage = friendlyMemoryCenterError(error);
      } finally {
        state.workbenchMemoryCenterBusy = false;
        requestRender();
      }
    },
    onMemoryCenterForgetFact: async () => {
      const agentId = (state.workbenchMemoryCenterAgentId ?? "").trim();
      const atomId = (state.workbenchMemoryCenterAtomId ?? "").trim();
      if (!agentId || !atomId) {
        state.workbenchMemoryCenterMessage = "请先选择要忘记的记忆要点。";
        requestRender();
        return;
      }
      if (!state.client || !state.connected) {
        state.workbenchMemoryCenterMessage = "当前未连接到网关。";
        requestRender();
        return;
      }
      const confirmed = window.confirm(
        "将 soft-forget 该记忆要点关联的全部来源（默认不永久清除/purge）。同一来源上的其他要点也会失去该来源。不会删除记忆文件入口。是否继续？",
      );
      if (!confirmed) {
        return;
      }
      state.workbenchMemoryCenterBusy = true;
      state.workbenchMemoryCenterMessage = null;
      requestRender();
      try {
        const result: {
          ok?: boolean;
          sources?: Array<{ status?: string; sourceLocator?: string; error?: string }>;
          error?: string;
        } = await state.client.request("data.memory.forgetFact", {
          agentId,
          atomId,
        });
        const sources = Array.isArray(result?.sources) ? result.sources : [];
        const forgotten = sources.filter((s) => s.status === "forgotten").length;
        const failed = sources.filter((s) => s.status === "failed").length;
        if (failed > 0 || result?.ok === false) {
          state.workbenchMemoryCenterMessage =
            result?.error?.trim() ||
            `事实遗忘部分失败：成功 ${forgotten}，失败 ${failed}（共 ${sources.length} 个来源）`;
        } else if (sources.length === 0) {
          state.workbenchMemoryCenterMessage = "该记忆要点没有可忘记的关联来源。";
        } else {
          state.workbenchMemoryCenterMessage = `已 soft-forget 该事实的全部来源（${forgotten}）`;
        }
        await loadWorkbenchMemoryCenterEntries(state, agentId, requestRender);
      } catch (error) {
        state.workbenchMemoryCenterMessage = friendlyMemoryCenterError(error);
      } finally {
        state.workbenchMemoryCenterBusy = false;
        requestRender();
      }
    },
  };
}
