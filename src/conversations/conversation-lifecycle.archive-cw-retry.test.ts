/**
 * Remediation §2.5: archive/restore idempotent re-entry must still call CogniWeave.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";

const bridge = vi.hoisted(() => ({
  notify: vi.fn(async () => ({ ok: true, errors: [] as string[] })),
}));

vi.mock("./cogniweave-bridge.js", () => ({
  notifyCogniWeaveConversationLifecycle: (...args: unknown[]) =>
    bridge.notify(...(args as Parameters<typeof bridge.notify>)),
}));

import {
  archiveConversation,
  createConversation,
  resetConversationCatalogCache,
  resolveConversationTenantContext,
  restoreConversation,
  type ConversationTenantContext,
} from "./index.js";

describe("conversation archive/restore CogniWeave retry (§2.5)", () => {
  const tmpRoots: string[] = [];
  const prevState = process.env.OPENCLAW_STATE_DIR;
  const prevHome = process.env.OPENBOT_HOME;

  afterEach(async () => {
    bridge.notify.mockClear();
    resetConversationCatalogCache();
    if (prevState === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = prevState;
    }
    if (prevHome === undefined) {
      delete process.env.OPENBOT_HOME;
    } else {
      process.env.OPENBOT_HOME = prevHome;
    }
    for (const root of tmpRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  function setupEnv(): {
    dataRoot: string;
    cfg: OpenBotConfig;
    ctx: ConversationTenantContext;
  } {
    const root = path.join(
      os.tmpdir(),
      `openbot-conv-cw-retry-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    tmpRoots.push(root);
    const dataRoot = path.join(root, "data");
    const stateDir = path.join(root, "state");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENBOT_HOME = root;
    const cfg = {
      data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 },
    } satisfies OpenBotConfig;
    const ctx = resolveConversationTenantContext({
      cfg,
      principalId: "user-cw-retry",
    });
    return { dataRoot, cfg, ctx };
  }

  async function seedConversation(params: {
    cfg: OpenBotConfig;
    ctx: ConversationTenantContext;
    dataRoot: string;
    title: string;
  }) {
    const created = await createConversation({
      deps: { cfg: params.cfg, ctx: params.ctx, dataRoot: params.dataRoot },
      surfaceType: "AGENT",
      agentId: "helper",
      title: params.title,
    });
    const livePath = path.join(
      process.env.OPENCLAW_STATE_DIR!,
      "agents",
      "helper",
      "sessions",
      `${created.binding.sessionId}.jsonl`,
    );
    await fs.appendFile(
      livePath,
      `${JSON.stringify({ type: "message", role: "user", content: "cw retry seed" })}\n`,
    );
    return { created, livePath };
  }

  it("re-archives an already-ARCHIVED conversation and still notifies CogniWeave", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const { created } = await seedConversation({
      cfg,
      ctx,
      dataRoot,
      title: "Archive retry",
    });

    const first = await archiveConversation({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
    });
    expect(first.record.lifecycleStatus).toBe("ARCHIVED");
    expect(bridge.notify).toHaveBeenCalledTimes(1);
    const notifyCalls = bridge.notify.mock.calls as unknown as Array<
      [{ mode: string; operationId: string }]
    >;
    const firstCall = notifyCalls[0]?.[0];
    expect(firstCall?.mode).toBe("archive");
    expect(firstCall?.operationId).toBe(
      `conv-archive-${created.record.conversationId}-${created.binding.bindingId}`,
    );

    const second = await archiveConversation({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
    });
    expect(second.record.lifecycleStatus).toBe("ARCHIVED");
    expect(bridge.notify).toHaveBeenCalledTimes(2);
    const secondCall = notifyCalls[1]?.[0];
    expect(secondCall?.mode).toBe("archive");
    expect(secondCall?.operationId).toBe(firstCall?.operationId);
  });

  it("re-restores an already-LIVE conversation and still notifies CogniWeave", async () => {
    const { cfg, ctx, dataRoot } = setupEnv();
    const { created } = await seedConversation({
      cfg,
      ctx,
      dataRoot,
      title: "Restore retry",
    });

    const archived = await archiveConversation({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
    });
    bridge.notify.mockClear();

    const first = await restoreConversation({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      etag: archived.record.etag,
      targetLifecycle: "ACTIVE",
    });
    expect(first.record.lifecycleStatus).toBe("ACTIVE");
    expect(bridge.notify).toHaveBeenCalledTimes(1);
    const restoreCalls = bridge.notify.mock.calls as unknown as Array<
      [{ mode: string; operationId: string }]
    >;
    const firstCall = restoreCalls[0]?.[0];
    expect(firstCall?.mode).toBe("restore");
    expect(firstCall?.operationId).toBe(
      `conv-restore-${created.record.conversationId}-${created.binding.bindingId}`,
    );

    // Drop archive copy so restore takes the LIVE idempotent re-entry path.
    await fs.rm(archived.archivePath, { force: true });

    const second = await restoreConversation({
      deps: { cfg, ctx, dataRoot },
      conversationId: created.record.conversationId,
      targetLifecycle: "ACTIVE",
    });
    expect(second.record.lifecycleStatus).toBe("ACTIVE");
    expect(bridge.notify).toHaveBeenCalledTimes(2);
    const secondCall = restoreCalls[1]?.[0];
    expect(secondCall?.mode).toBe("restore");
    expect(secondCall?.operationId).toBe(firstCall?.operationId);
  });
});
