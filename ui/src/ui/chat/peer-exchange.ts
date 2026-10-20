/**
 * 1:1 digital-human exchange chrome.
 * Received peers and outbound `sentTo` envelopes share a counterpart key so
 * consecutive turns can fold. Group-chat assistants never enter this path.
 */

import type { MessageGroup } from "../types/chat-types.ts";
import type { NormalizedMessage } from "../types/chat-types.ts";

export type PeerSentTarget = {
  agentId: string | null;
  label: string;
  sessionKey: string | null;
};

export type PeerRouteParty = {
  label: string;
  agentId: string | null;
};

export type PeerRoute = {
  direction: "received" | "sent";
  parties: PeerRouteParty[];
};

export type PeerExchangeFold = {
  kind: "peer-exchange";
  key: string;
  labels: string[];
  count: number;
  groups: MessageGroup[];
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readPeerSentTargets(message: unknown): PeerSentTarget[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const raw = (message as { sentTo?: unknown }).sentTo;
  if (!Array.isArray(raw)) {
    return [];
  }
  const targets: PeerSentTarget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const label = trimmed(record.label);
    if (!label) {
      continue;
    }
    const agentId = trimmed(record.agentId);
    const sessionKey = trimmed(record.sessionKey);
    targets.push({
      label,
      agentId: agentId || null,
      sessionKey: sessionKey || null,
    });
  }
  return targets;
}

export function peerRouteFromNormalized(message: NormalizedMessage): PeerRoute | null {
  if (message.role === "peer-out" && message.sentTo && message.sentTo.length > 0) {
    return {
      direction: "sent",
      parties: message.sentTo.map((target) => ({
        label: target.label,
        agentId: target.agentId,
      })),
    };
  }
  if (message.role === "peer") {
    return {
      direction: "received",
      parties: [
        {
          label: message.senderLabel?.trim() || "数字人",
          agentId: message.agentId ?? null,
        },
      ],
    };
  }
  return null;
}

export function peerCounterpartKey(labels: readonly string[] | undefined): string | null {
  const normalized = (labels ?? [])
    .map((label) => label.trim())
    .filter(Boolean)
    .toSorted();
  if (normalized.length === 0) {
    return null;
  }
  return normalized.join("\0");
}

type ThreadItem = { kind: string; key: string };

function isMessageGroup(item: ThreadItem): item is MessageGroup {
  return item.kind === "group";
}

/**
 * Fold consecutive 1:1 peer turns that share one counterpart.
 * A single message stays expanded. N≥2 starts collapsed at render time.
 */
export function foldPeerExchangeThread<T extends ThreadItem>(
  items: T[],
): Array<T | PeerExchangeFold> {
  const result: Array<T | PeerExchangeFold> = [];
  let run: MessageGroup[] = [];
  let runKey: string | null = null;

  const flush = () => {
    if (run.length === 0) {
      return;
    }
    const count = run.reduce((total, group) => total + group.messages.length, 0);
    const labels = (run[0]?.peerLabels ?? []).map((label) => label.trim()).filter(Boolean);
    if (count >= 2 && runKey && labels.length > 0) {
      result.push({
        kind: "peer-exchange",
        key: `peer-exchange:${run[0]?.key ?? runKey}`,
        labels,
        count,
        groups: run,
      });
    } else {
      result.push(...(run as unknown as T[]));
    }
    run = [];
    runKey = null;
  };

  for (const item of items) {
    if (!isMessageGroup(item) || item.isStreaming) {
      flush();
      result.push(item);
      continue;
    }
    const key = peerCounterpartKey(item.peerLabels);
    if (!key) {
      flush();
      result.push(item);
      continue;
    }
    if (runKey && runKey !== key) {
      flush();
    }
    runKey = key;
    run.push(item);
  }
  flush();
  return result;
}
