import type { GatewayBrowserClient } from "../../gateway.ts";
import type { AssetAdoptionEvidence } from "./types.ts";

const ADOPTION_STORAGE_KEY = "openbot.asset-incubation.adoption.v1";
const USER_INITIATED_STORAGE_KEY = "openbot.asset-incubation.user-initiated.v1";

export type LocalAdoptionRecord = {
  capabilityId: string;
  adoption: AssetAdoptionEvidence;
  updatedAt: number;
};

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function loadAdoptionRecords(): LocalAdoptionRecord[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = localStorage.getItem(ADOPTION_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const capabilityId =
        typeof record.capabilityId === "string" ? record.capabilityId.trim() : "";
      const adoption = record.adoption;
      if (!capabilityId || !adoption || typeof adoption !== "object") {
        return [];
      }
      const adoptionRecord = adoption as Record<string, unknown>;
      return [
        {
          capabilityId,
          adoption: {
            distinctMemberCount:
              typeof adoptionRecord.distinctMemberCount === "number"
                ? adoptionRecord.distinctMemberCount
                : 0,
            sharedToGroup: adoptionRecord.sharedToGroup === true,
            adminRecommended: adoptionRecord.adminRecommended === true,
            enterpriseSubmitted: adoptionRecord.enterpriseSubmitted === true,
          },
          updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
        } satisfies LocalAdoptionRecord,
      ];
    });
  } catch {
    return [];
  }
}

function saveAdoptionRecords(records: LocalAdoptionRecord[]): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(ADOPTION_STORAGE_KEY, JSON.stringify(records.slice(-200)));
  } catch {
    // best-effort
  }
}

export function adoptionFromShareVisibility(
  shareVisibility: string | null | undefined,
): AssetAdoptionEvidence {
  const visibility = shareVisibility?.trim() ?? "";
  return {
    distinctMemberCount: 0,
    sharedToGroup: visibility === "已共享到协作小组",
    adminRecommended: false,
    enterpriseSubmitted:
      visibility === "已进入企业资产库" ||
      visibility === "审核中" ||
      visibility === "需要修改后再次提交",
  };
}

export function loadLocalAdoptionOverlay(params: {
  capabilityId?: string | null;
  shareVisibility?: string | null;
}): AssetAdoptionEvidence {
  const capabilityId = params.capabilityId?.trim();
  const fromVisibility = adoptionFromShareVisibility(params.shareVisibility);
  if (!capabilityId) {
    return fromVisibility;
  }
  const stored = loadAdoptionRecords().find((entry) => entry.capabilityId === capabilityId);
  if (!stored) {
    return fromVisibility;
  }
  return mergeAdoptionEvidence(stored.adoption, fromVisibility);
}

export function mergeAdoptionEvidence(
  left: AssetAdoptionEvidence,
  right: AssetAdoptionEvidence,
): AssetAdoptionEvidence {
  return {
    distinctMemberCount: Math.max(left.distinctMemberCount, right.distinctMemberCount),
    sharedToGroup: left.sharedToGroup || right.sharedToGroup,
    adminRecommended: left.adminRecommended || right.adminRecommended,
    enterpriseSubmitted: left.enterpriseSubmitted || right.enterpriseSubmitted,
  };
}

export function recordLocalAdoption(
  capabilityId: string,
  patch: Partial<AssetAdoptionEvidence>,
): void {
  const normalized = capabilityId.trim();
  if (!normalized) {
    return;
  }
  const existing = loadAdoptionRecords().filter((entry) => entry.capabilityId !== normalized);
  const current = loadAdoptionRecords().find((entry) => entry.capabilityId === normalized)
    ?.adoption ?? {
    distinctMemberCount: 0,
    sharedToGroup: false,
    adminRecommended: false,
    enterpriseSubmitted: false,
  };
  saveAdoptionRecords([
    ...existing,
    {
      capabilityId: normalized,
      adoption: mergeAdoptionEvidence(current, {
        distinctMemberCount: patch.distinctMemberCount ?? current.distinctMemberCount,
        sharedToGroup: patch.sharedToGroup ?? current.sharedToGroup,
        adminRecommended: patch.adminRecommended ?? current.adminRecommended,
        enterpriseSubmitted: patch.enterpriseSubmitted ?? current.enterpriseSubmitted,
      }),
      updatedAt: Date.now(),
    },
  ]);
}

function loadUserInitiatedCount(contextId?: string | null): number {
  if (!canUseStorage()) {
    return 0;
  }
  try {
    const raw = localStorage.getItem(USER_INITIATED_STORAGE_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return 0;
    }
    const context = contextId?.trim();
    if (!context) {
      return parsed.length;
    }
    return parsed.filter((entry) => entry === context).length;
  } catch {
    return 0;
  }
}

export function recordLocalUserInitiatedSave(contextId?: string | null): void {
  if (!canUseStorage()) {
    return;
  }
  const context = contextId?.trim();
  if (!context) {
    return;
  }
  try {
    const raw = localStorage.getItem(USER_INITIATED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const next = Array.isArray(parsed) ? [...parsed, context] : [context];
    localStorage.setItem(USER_INITIATED_STORAGE_KEY, JSON.stringify(next.slice(-200)));
  } catch {
    // best-effort
  }
}

export async function fetchGatewayAdoptionSummary(
  client: GatewayBrowserClient | null | undefined,
  params: { capabilityId?: string | null; contextId?: string | null },
): Promise<{ adoption: AssetAdoptionEvidence; userInitiatedSaveCount: number } | null> {
  if (!client) {
    return null;
  }
  try {
    const response = await client.request<{
      summary?: {
        adoption?: AssetAdoptionEvidence;
        userInitiatedSaveCount?: number;
      };
    }>("asset-incubation.evidence.summary", {
      clusterId: params.contextId ?? null,
      contextId: params.contextId ?? null,
      capabilityId: params.capabilityId ?? null,
    });
    const summary = response?.summary;
    if (!summary?.adoption) {
      return null;
    }
    if (summary.adoption.adminRecommended && params.capabilityId?.trim()) {
      recordLocalAdoption(params.capabilityId, { adminRecommended: true });
    }
    return {
      adoption: summary.adoption,
      userInitiatedSaveCount: summary.userInitiatedSaveCount ?? 0,
    };
  } catch {
    return null;
  }
}

export async function syncContextCapabilityLink(
  client: GatewayBrowserClient | null | undefined,
  contextId: string,
  capabilityId: string,
): Promise<void> {
  if (!client || !contextId.trim() || !capabilityId.trim()) {
    return;
  }
  try {
    await client.request("asset-incubation.context.link", { contextId, capabilityId });
  } catch {
    // best-effort
  }
}

export async function syncUserInitiatedSave(
  client: GatewayBrowserClient | null | undefined,
  params: { contextId?: string | null; capabilityId?: string | null },
): Promise<void> {
  recordLocalUserInitiatedSave(params.contextId);
  if (!client) {
    return;
  }
  try {
    await client.request("asset-incubation.user-initiated.record", {
      contextId: params.contextId ?? null,
      capabilityId: params.capabilityId ?? null,
    });
  } catch {
    // best-effort
  }
}

export function localUserInitiatedSaveCount(contextId?: string | null): number {
  return loadUserInitiatedCount(contextId);
}

export function clearAdoptionStorageForTests(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(ADOPTION_STORAGE_KEY);
  localStorage.removeItem(USER_INITIATED_STORAGE_KEY);
}
