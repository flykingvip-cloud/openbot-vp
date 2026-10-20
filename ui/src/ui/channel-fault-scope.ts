import type { ChannelsStatusSnapshot } from "./types.ts";

/**
 * Channel runtime faults stay on the channel that reported them.
 * They are not a Control UI gateway connection phase and must not be copied
 * onto host.lastError (chat disconnect / reconnecting / unreachable banners).
 */

export type ChannelFault = {
  channelId: string;
  accountId: string | null;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function collectChannelFaults(
  snapshot: ChannelsStatusSnapshot | null | undefined,
): ChannelFault[] {
  if (!snapshot) {
    return [];
  }
  const faults: ChannelFault[] = [];
  const channels = asRecord(snapshot.channels) ?? {};
  for (const [channelId, raw] of Object.entries(channels)) {
    const message = trimmed(asRecord(raw)?.lastError);
    if (message) {
      faults.push({ channelId, accountId: null, message });
    }
  }
  for (const [channelId, accounts] of Object.entries(snapshot.channelAccounts ?? {})) {
    for (const account of accounts ?? []) {
      const message = trimmed(account.lastError);
      if (message) {
        faults.push({ channelId, accountId: account.accountId, message });
      }
    }
  }
  return faults;
}

/** First fault for one channel: summary lastError, then any account lastError. */
export function channelFaultMessage(
  snapshot: ChannelsStatusSnapshot | null | undefined,
  channelId: string,
): string | null {
  return (
    collectChannelFaults(snapshot).find((fault) => fault.channelId === channelId)?.message ?? null
  );
}

/**
 * Chat and the classic page header read host.lastError. Drop strings that are
 * only a channels.status load failure or a per-channel snapshot fault.
 * Gateway banners do not use this value; they follow connection phase.
 */
export function selectVisibleHostError(params: {
  lastError: string | null | undefined;
  channelsError?: string | null;
  snapshot?: ChannelsStatusSnapshot | null;
}): string | null {
  const message = trimmed(params.lastError);
  if (!message) {
    return null;
  }
  const channelsError = trimmed(params.channelsError);
  if (channelsError && message === channelsError) {
    return null;
  }
  if (collectChannelFaults(params.snapshot).some((fault) => fault.message === message)) {
    return null;
  }
  return params.lastError ?? null;
}

/**
 * A channel config save/reload writes through the shared config controller,
 * which sets host.lastError. Return that new string as a channel-page fault
 * and put the previous host error back.
 */
export function detachChannelConfigFault(params: {
  priorHostError: string | null;
  nextHostError: string | null;
}): { hostError: string | null; channelFault: string | null } {
  const prior = params.priorHostError;
  const next = params.nextHostError;
  if (next && next !== prior) {
    return { hostError: prior, channelFault: next };
  }
  return { hostError: prior ?? next, channelFault: null };
}
