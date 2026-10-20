import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { newId, pushAudit, withMonitorStore } from "./monitor-store.js";
import { sendOutboxNotification } from "./notify.js";
import { claimDueOutbox, markOutboxFailure, markOutboxSent } from "./outbox.js";

export async function flushOutbox(params: {
  api: OpenClawPluginApi;
  storePath: string;
  limit?: number;
  owner?: string;
  tenantId?: string;
  agentId?: string;
}): Promise<{ sent: number; failed: number; deadLetter: number }> {
  const owner = params.owner?.trim() || `flush:${process.pid}:${newId("own")}`;
  const claimed = await withMonitorStore(params.storePath, (data) => {
    return claimDueOutbox(data, {
      owner,
      limit: params.limit ?? 20,
      tenantId: params.tenantId,
      agentId: params.agentId,
    }).map((row) => structuredClone(row));
  });

  let sent = 0;
  let failed = 0;
  let deadLetter = 0;

  for (const snapshot of claimed) {
    const result = await sendOutboxNotification({ api: params.api, row: snapshot });
    await withMonitorStore(params.storePath, (data) => {
      const live = data.outbox.find((item) => item.id === snapshot.id);
      if (!live) {
        return;
      }
      // Another owner may have reclaimed after claim expiry — do not clobber.
      if (live.status === "sending" && live.claimOwner && live.claimOwner !== owner) {
        return;
      }
      if (result.ok) {
        markOutboxSent(live);
        sent += 1;
        pushAudit(data, {
          action: "outbox.sent",
          targetId: live.targetId,
          eventId: live.eventId,
          tenantId: live.tenantId,
          agentId: live.agentId,
          detail: { channel: live.channel },
        });
        return;
      }
      markOutboxFailure(live, result.error);
      if (live.status === "dead_letter") {
        deadLetter += 1;
      } else {
        failed += 1;
      }
      pushAudit(data, {
        action: "outbox.failed",
        targetId: live.targetId,
        eventId: live.eventId,
        tenantId: live.tenantId,
        agentId: live.agentId,
        detail: { error: result.error, status: live.status },
      });
    });
  }

  return { sent, failed, deadLetter };
}
