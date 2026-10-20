import type { GatewayBrowserClient } from "../../gateway.ts";

const EXTERNALIZATION_STORAGE_KEY = "openbot.asset-incubation.externalization.v1";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type ExternalizationKind = "copy" | "download" | "share" | "submit";

export type ExternalizationSignal = {
  kind: ExternalizationKind;
  contextId: string | null;
  sessionKey: string | null;
  occurredAt: number;
};

let activeSessionKey: string | null = null;

export function setExternalizationSessionKey(sessionKey: string | null): void {
  activeSessionKey = sessionKey?.trim() || null;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function loadSignals(now = Date.now()): ExternalizationSignal[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = localStorage.getItem(EXTERNALIZATION_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const cutoff = now - RETENTION_MS;
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const kind = record.kind;
      const occurredAt = typeof record.occurredAt === "number" ? record.occurredAt : 0;
      if (
        (kind !== "copy" && kind !== "download" && kind !== "share" && kind !== "submit") ||
        occurredAt < cutoff
      ) {
        return [];
      }
      return [
        {
          kind,
          contextId: typeof record.contextId === "string" ? record.contextId : null,
          sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : null,
          occurredAt,
        } satisfies ExternalizationSignal,
      ];
    });
  } catch {
    return [];
  }
}

function saveSignals(signals: ExternalizationSignal[]): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(EXTERNALIZATION_STORAGE_KEY, JSON.stringify(signals.slice(-500)));
  } catch {
    // best-effort
  }
}

export function countExternalizationSignals(contextId?: string | null, now = Date.now()): number {
  const signals = loadSignals(now);
  if (!contextId) {
    return signals.length;
  }
  return signals.filter((entry) => entry.contextId === contextId).length;
}

export function recordExternalizationSignal(params: {
  kind: ExternalizationKind;
  contextId?: string | null;
  sessionKey?: string | null;
  client?: GatewayBrowserClient | null;
  occurredAt?: number;
}): void {
  const occurredAt = params.occurredAt ?? Date.now();
  const signal: ExternalizationSignal = {
    kind: params.kind,
    contextId: params.contextId?.trim() || null,
    sessionKey: params.sessionKey?.trim() || activeSessionKey,
    occurredAt,
  };
  const next = [...loadSignals(occurredAt), signal];
  saveSignals(next);
  if (params.client) {
    void params.client
      .request("asset-incubation.externalization.record", {
        kind: signal.kind,
        contextId: signal.contextId,
        sessionKey: signal.sessionKey,
      })
      .catch(() => undefined);
  }
}

export function clearExternalizationSignalsForTests(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(EXTERNALIZATION_STORAGE_KEY);
}
