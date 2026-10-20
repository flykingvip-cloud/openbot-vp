export type WorkbenchDataSpaceMode = "local" | "managed";

export type WorkbenchDataSpaceSettings = {
  mode: WorkbenchDataSpaceMode;
  /** User-visible root, e.g. `~/OpenBot`. Empty when managed. */
  displayRoot: string;
  /** True when install/onboard has provisioned Data Space (or SaaS managed). */
  isConfigured: boolean;
};

export const DEFAULT_DATA_SPACE_DISPLAY_ROOT = "~/OpenBot";

type RecordLike = Record<string, unknown>;

function toRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RecordLike;
}

function normalizeMode(value: unknown): WorkbenchDataSpaceMode {
  return value === "managed" ? "managed" : "local";
}

export function resolveWorkbenchDataSpaceSettings(params: {
  config?: unknown;
  bootstrapMode?: WorkbenchDataSpaceMode | null;
  bootstrapDisplayRoot?: string | null;
}): WorkbenchDataSpaceSettings {
  const data = toRecord(toRecord(params.config)?.data);
  const mode = data?.mode ? normalizeMode(data.mode) : normalizeMode(params.bootstrapMode);
  const configuredRoot = typeof data?.root === "string" ? data.root.trim() : "";
  const schemaVersion = typeof data?.schemaVersion === "number" ? data.schemaVersion : null;
  // Phase 1: local installs default to ~/OpenBot; SaaS uses managed mode — both are "ready".
  const isConfigured =
    mode === "managed" || mode === "local" || Boolean(configuredRoot) || schemaVersion != null;
  const displayRoot =
    mode === "managed"
      ? ""
      : params.bootstrapDisplayRoot?.trim() || configuredRoot || DEFAULT_DATA_SPACE_DISPLAY_ROOT;
  return { mode, displayRoot, isConfigured };
}

/** Preview path under Data Root for agents/groups (Data Space model §3). */
export function deriveAgentSpacePreview(dataRoot: string, agentId: string): string {
  const root = dataRoot.trim() || DEFAULT_DATA_SPACE_DISPLAY_ROOT;
  const id = agentId.trim();
  if (!id) {
    return root;
  }
  return `${root.replace(/\/+$/, "")}/agents/${id}`;
}

export function deriveSharedGroupSpacePreview(dataRoot: string, groupId: string): string {
  const root = dataRoot.trim() || DEFAULT_DATA_SPACE_DISPLAY_ROOT;
  const id = groupId.trim();
  if (!id) {
    return `${root.replace(/\/+$/, "")}/shared/knowledge`;
  }
  return `${root.replace(/\/+$/, "")}/shared/knowledge/groups/${id}`;
}
