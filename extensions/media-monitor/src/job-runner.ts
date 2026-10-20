import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { crawlViaAdapter } from "./adapter.js";
import type { MediaMonitorPluginConfig } from "./config.js";
import {
  applyEmptyRunBackoff,
  applyFailureCooldown,
  mapErrorToEventType,
  resetEmptyRunBackoff,
} from "./health.js";
import { acquireLease, releaseOwnedLease } from "./lease.js";
import {
  assertTenantAccess,
  findTarget,
  insertEventIfAbsent,
  newId,
  nowIso,
  pushAudit,
  withMonitorStore,
} from "./monitor-store.js";
import {
  commentItemToEvent,
  contentItemToEvent,
  healthEvent,
  summarizeSuccessItems,
} from "./normalizer.js";
import { createOutboxForEvent } from "./outbox.js";
import { redactText } from "./redact.js";
import type {
  AdapterCommentItem,
  AdapterContentItem,
  AdapterErrorCategory,
  MonitorTarget,
} from "./types.js";

export type JobRunnerDeps = {
  api: OpenClawPluginApi;
  storePath: string;
  config: MediaMonitorPluginConfig;
  ownerId: string;
  resolveCookie?: () => string | undefined;
};

type CrawlOk = {
  ok: true;
  runId: string;
  contents: AdapterContentItem[];
  comments: AdapterCommentItem[];
};

type CrawlFail = {
  ok: false;
  category: AdapterErrorCategory;
  message: string;
  providerCode?: string;
};

function resolveNotify(params: { target: MonitorTarget; config: MediaMonitorPluginConfig }): {
  channel?: string;
  to?: string;
  accountId?: string;
} {
  return {
    channel: params.target.notifyChannel || params.config.notifyChannel,
    to: params.target.notifyTo || params.config.notifyTo,
    accountId: params.target.notifyAccountId || params.config.notifyAccountId,
  };
}

function recordStructuredFailure(params: {
  data: Parameters<typeof insertEventIfAbsent>[0];
  target: MonitorTarget;
  category: AdapterErrorCategory;
  message: string;
  providerCode?: string;
  config: MediaMonitorPluginConfig;
  now: number;
}): void {
  const eventType = mapErrorToEventType(params.category);
  const event = healthEvent({
    target: params.target,
    eventType,
    message: redactText(params.message, 400),
    providerCode: params.providerCode,
    observedAt: nowIso(params.now),
  });
  insertEventIfAbsent(params.data, event);
  applyFailureCooldown({ target: params.target, category: params.category, now: params.now });
  params.target.updatedAt = nowIso(params.now);
  const notify = resolveNotify({ target: params.target, config: params.config });
  if (notify.channel && notify.to) {
    createOutboxForEvent({
      data: params.data,
      target: params.target,
      event,
      channel: notify.channel,
      destination: notify.to,
      accountId: notify.accountId,
      now: params.now,
    });
  }
  pushAudit(params.data, {
    action: "crawl.failed",
    targetId: params.target.id,
    tenantId: params.target.tenantId,
    agentId: params.target.agentId,
    detail: { category: params.category, eventType },
  });
}

async function invokeAdapter(params: {
  deps: JobRunnerDeps;
  target: MonitorTarget;
  mode: "creator" | "comments";
  contentId?: string;
}): Promise<CrawlOk | CrawlFail> {
  const command = params.deps.config.adapterCommand;
  if (!command?.length) {
    return {
      ok: false,
      category: "process_error",
      message: "adapterCommand is not configured",
    };
  }

  const result = await crawlViaAdapter({
    platform: params.target.platform,
    accountId: params.target.accountId,
    accountUrl: params.target.accountUrl,
    mode: params.mode,
    contentId: params.contentId,
    command,
    cwd: params.deps.config.adapterCwd,
    cookieValue: params.deps.resolveCookie?.(),
    timeoutMs: params.deps.config.timeoutMs,
    maxStdoutBytes: params.deps.config.maxStdoutBytes,
  });

  if (!result.ok) {
    return {
      ok: false,
      category: result.error.category,
      message: result.error.message,
    };
  }
  if ("error" in result.envelope) {
    return {
      ok: false,
      category: result.envelope.error.category,
      message: result.envelope.error.message,
      providerCode: result.envelope.error.provider_code,
    };
  }

  const { contents, comments } = summarizeSuccessItems(result.envelope);
  return {
    ok: true,
    runId: result.envelope.run.id,
    contents,
    comments,
  };
}

function commitSuccessfulCrawl(params: {
  data: Parameters<typeof insertEventIfAbsent>[0];
  target: MonitorTarget;
  config: MediaMonitorPluginConfig;
  contents: AdapterContentItem[];
  comments: AdapterCommentItem[];
  runId: string;
  now: number;
}): { newContent: number; newComments: number } {
  const notifyCfg = resolveNotify({ target: params.target, config: params.config });
  const baselineEstablished = params.target.cursor.baselineEstablished;
  let newContent = 0;
  let newComments = 0;

  for (const item of params.contents) {
    const event = contentItemToEvent({
      target: params.target,
      item,
      observedAt: nowIso(params.now),
    });
    const { inserted, event: stored } = insertEventIfAbsent(params.data, event);
    if (!inserted) {
      continue;
    }
    newContent += 1;
    if (baselineEstablished && notifyCfg.channel && notifyCfg.to) {
      createOutboxForEvent({
        data: params.data,
        target: params.target,
        event: stored,
        channel: notifyCfg.channel,
        destination: notifyCfg.to,
        accountId: notifyCfg.accountId,
        now: params.now,
      });
    }
  }

  for (const item of params.comments) {
    const event = commentItemToEvent({
      target: params.target,
      item,
      observedAt: nowIso(params.now),
    });
    const { inserted, event: stored } = insertEventIfAbsent(params.data, event);
    if (!inserted) {
      continue;
    }
    newComments += 1;
    if (baselineEstablished && notifyCfg.channel && notifyCfg.to) {
      createOutboxForEvent({
        data: params.data,
        target: params.target,
        event: stored,
        channel: notifyCfg.channel,
        destination: notifyCfg.to,
        accountId: notifyCfg.accountId,
        now: params.now,
      });
    }
  }

  // Cursor advances only after a fully successful job.
  if (!baselineEstablished) {
    params.target.cursor.baselineEstablished = true;
  }
  params.target.cursor.lastRunId = params.runId;
  params.target.cursor.lastSuccessAt = nowIso(params.now);
  params.target.lastSuccessAt = nowIso(params.now);
  params.target.healthState = "ok";
  params.target.cursor.cooldownUntil = undefined;
  params.target.updatedAt = nowIso(params.now);

  if (newContent + newComments === 0) {
    applyEmptyRunBackoff(params.target, params.now);
  } else {
    resetEmptyRunBackoff(params.target);
  }

  pushAudit(params.data, {
    action: "crawl.succeeded",
    targetId: params.target.id,
    tenantId: params.target.tenantId,
    agentId: params.target.agentId,
    detail: {
      newContent,
      newComments,
      baselineWasEstablished: baselineEstablished,
      runId: params.runId,
    },
  });

  return { newContent, newComments };
}

export async function runMonitorTargetJob(params: {
  deps: JobRunnerDeps;
  targetId: string;
  tenantId?: string;
  agentId?: string;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  newContent?: number;
  newComments?: number;
}> {
  const owner = params.deps.ownerId || newId("owner");

  const leaseResult = await withMonitorStore(params.deps.storePath, (data) => {
    const target = findTarget(data, params.targetId);
    if (!target) {
      return { ok: false as const, reason: "target_not_found" };
    }
    assertTenantAccess({
      target,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    if (!target.enabled) {
      return { ok: false as const, reason: "target_disabled" };
    }
    const acquired = acquireLease({ data, targetId: target.id, owner });
    if (!acquired.ok) {
      return { ok: false as const, reason: "lease_held" };
    }
    pushAudit(data, {
      action: "lease.acquired",
      targetId: target.id,
      tenantId: target.tenantId,
      agentId: target.agentId,
      detail: { owner },
    });
    return { ok: true as const, target: structuredClone(target) };
  });

  if (!leaseResult.ok) {
    return { ok: false, skipped: true, reason: leaseResult.reason };
  }

  const target = leaseResult.target;
  const collectedContents: AdapterContentItem[] = [];
  const collectedComments: AdapterCommentItem[] = [];
  let runId = newId("run");

  try {
    const creatorResult = await invokeAdapter({
      deps: params.deps,
      target,
      mode: "creator",
    });
    if (!creatorResult.ok) {
      await withMonitorStore(params.deps.storePath, (data) => {
        const live = findTarget(data, target.id);
        if (!live) {
          return;
        }
        recordStructuredFailure({
          data,
          target: live,
          category: creatorResult.category,
          message: creatorResult.message,
          providerCode: creatorResult.providerCode,
          config: params.deps.config,
          now: Date.now(),
        });
      });
      return { ok: false, reason: creatorResult.category };
    }
    runId = creatorResult.runId;
    collectedContents.push(...creatorResult.contents);
    collectedComments.push(...creatorResult.comments);

    for (const contentId of target.watchedContentIds) {
      const commentResult = await invokeAdapter({
        deps: params.deps,
        target,
        mode: "comments",
        contentId,
      });
      if (!commentResult.ok) {
        await withMonitorStore(params.deps.storePath, (data) => {
          const live = findTarget(data, target.id);
          if (!live) {
            return;
          }
          recordStructuredFailure({
            data,
            target: live,
            category: commentResult.category,
            message: commentResult.message,
            providerCode: commentResult.providerCode,
            config: params.deps.config,
            now: Date.now(),
          });
        });
        // Partial adapter success must not advance cursor.
        return { ok: false, reason: commentResult.category };
      }
      collectedContents.push(...commentResult.contents);
      collectedComments.push(...commentResult.comments);
    }

    const committed = await withMonitorStore(params.deps.storePath, (data) => {
      const live = findTarget(data, target.id);
      if (!live) {
        throw new Error("target disappeared during crawl");
      }
      return commitSuccessfulCrawl({
        data,
        target: live,
        config: params.deps.config,
        contents: collectedContents,
        comments: collectedComments,
        runId,
        now: Date.now(),
      });
    });

    return {
      ok: true,
      newContent: committed.newContent,
      newComments: committed.newComments,
    };
  } finally {
    await withMonitorStore(params.deps.storePath, (data) => {
      releaseOwnedLease({ data, targetId: target.id, owner });
      pushAudit(data, {
        action: "lease.released",
        targetId: target.id,
        tenantId: target.tenantId,
        agentId: target.agentId,
        detail: { owner },
      });
    });
  }
}
