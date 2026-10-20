import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePluginConfig } from "./config.js";
import { runMonitorTargetJob } from "./job-runner.js";
import {
  findTarget,
  readMonitorStore,
  resolveMonitorStorePath,
  withMonitorStore,
} from "./monitor-store.js";
import { flushOutbox } from "./outbox-flusher.js";
import { addMonitorTarget } from "./targets.js";
import type { MonitorTarget } from "./types.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-adapter.mjs",
);

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.FAKE_ADAPTER_SCENARIO;
  delete process.env.FAKE_ADAPTER_SLEEP_MS;
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function setup(scenario: string) {
  process.env.FAKE_ADAPTER_SCENARIO = scenario;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-monitor-"));
  tempDirs.push(stateDir);
  const storePath = resolveMonitorStorePath(stateDir);
  const sent: Array<{ to: string; text: string }> = [];
  const api = {
    id: "media-monitor",
    runtime: {
      channel: {
        telegram: {
          sendMessageTelegram: async (to: string, text: string) => {
            sent.push({ to, text });
            return { ok: true };
          },
        },
      },
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as OpenClawPluginApi;

  const config = resolvePluginConfig({
    adapterCommand: ["node", fixturePath, "--scenario", scenario],
    notifyChannel: "telegram",
    notifyTo: "chat-1",
    defaultPollIntervalSeconds: 1800,
    timeoutMs: 10_000,
  });

  const suffix = crypto.randomBytes(4).toString("hex");
  const target = await addMonitorTarget({
    storePath,
    config,
    input: {
      tenantId: `tenant-${suffix}`,
      agentId: `agent-${suffix}`,
      accountId: `xhs-user-${suffix}`,
      accountUrl: "https://example.invalid/profile",
      displayName: "Demo",
      watchedContentIds: scenario === "new_content" ? [] : ["note-watch-1"],
      notifyChannel: "telegram",
      notifyTo: "chat-1",
    },
  });

  const deps = {
    api,
    storePath,
    config,
    ownerId: `test-owner-${suffix}`,
  };

  return { api, storePath, config, target, deps, sent };
}

function withScenario(
  ctx: Awaited<ReturnType<typeof setup>>,
  scenario: string,
): Awaited<ReturnType<typeof setup>> {
  const config = resolvePluginConfig({
    ...ctx.config,
    adapterCommand: ["node", fixturePath, "--scenario", scenario],
  });
  return {
    ...ctx,
    config,
    deps: {
      ...ctx.deps,
      config,
    },
  };
}

async function withMonitorStorePatch(
  storePath: string,
  targetId: string,
  patch: (target: MonitorTarget) => void,
): Promise<void> {
  await withMonitorStore(storePath, (data) => {
    const target = findTarget(data, targetId);
    if (target) {
      patch(target);
    }
  });
}

describe("media-monitor job-runner e2e (fake adapter)", () => {
  it("establishes baseline without notifying historical content/comments", async () => {
    const ctx = await setup("baseline");
    const result = await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    expect(result.ok).toBe(true);
    const store = await readMonitorStore(ctx.storePath);
    expect(store.targets[0]?.cursor.baselineEstablished).toBe(true);
    expect(store.events.some((e) => e.eventType === "content.created")).toBe(true);
    expect(store.outbox).toHaveLength(0);
    await flushOutbox({ api: ctx.api, storePath: ctx.storePath });
    expect(ctx.sent).toHaveLength(0);
  });

  it("notifies new content once and is idempotent across restarts", async () => {
    const ctx = await setup("baseline");
    // Avoid comment side-channel so this test isolates content.created notifications.
    await withMonitorStorePatch(ctx.storePath, ctx.target.id, (t) => {
      t.watchedContentIds = [];
    });
    await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });

    const next = withScenario(ctx, "new_content");
    const first = await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });
    expect(first.ok).toBe(true);
    expect(first.newContent).toBe(1);

    const before = await readMonitorStore(ctx.storePath);
    expect(before.outbox.filter((r) => r.status === "pending")).toHaveLength(1);

    const second = await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });
    expect(second.ok).toBe(true);
    expect(second.newContent).toBe(0);

    // Simulate process restart: re-read store and run again.
    const third = await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });
    expect(third.newContent).toBe(0);

    await flushOutbox({ api: ctx.api, storePath: ctx.storePath });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]?.text).toContain("[监测]");
    expect(ctx.sent[0]?.text).toContain("fresh note");
    expect(ctx.sent[0]?.text).not.toContain("cookie");

    const after = await readMonitorStore(ctx.storePath);
    expect(after.outbox.every((r) => r.status === "sent")).toBe(true);
    const contentEvents = after.events.filter((e) => e.eventType === "content.created");
    const dedupeKeys = new Set(contentEvents.map((e) => e.dedupeKey));
    expect(dedupeKeys.size).toBe(contentEvents.length);
  });

  it("notifies new comments once with content-scoped ids", async () => {
    const ctx = await setup("baseline");
    await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    const next = withScenario(ctx, "new_comment");
    const result = await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });
    expect(result.ok).toBe(true);
    expect((result.newComments ?? 0) > 0).toBe(true);
    const store = await readMonitorStore(ctx.storePath);
    const comment = store.events.find(
      (e) => e.eventType === "comment.created" && e.payloadJson.text === "brand new comment",
    );
    expect(comment?.platformObjectId).toContain("note-watch-1:");
    expect(store.outbox.some((r) => r.eventId === comment?.id)).toBe(true);
  });

  it("dedupes paginated duplicate platform ids", async () => {
    const ctx = await setup("baseline");
    await withMonitorStorePatch(ctx.storePath, ctx.target.id, (t) => {
      t.watchedContentIds = [];
    });
    await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    const next = withScenario(ctx, "paginated_dupes");
    const result = await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });
    expect(result.ok).toBe(true);
    expect(result.newContent).toBe(2);
    const store = await readMonitorStore(ctx.storePath);
    const ids = store.events
      .filter((e) => e.eventType === "content.created")
      .map((e) => e.platformObjectId);
    expect(ids.filter((id) => id === "note-a")).toHaveLength(1);
  });

  it.each([
    {
      scenario: "rate_limit" as const,
      reason: "rate_limit",
      health: "rate_limited" as const,
      eventType: "monitor.rate_limited" as const,
    },
    {
      scenario: "reauth" as const,
      reason: "reauth_required",
      health: "reauth_required" as const,
      eventType: "monitor.reauth_required" as const,
    },
    {
      scenario: "captcha" as const,
      reason: "captcha",
      health: "rate_limited" as const,
      eventType: "monitor.rate_limited" as const,
    },
  ])("does not advance cursor on $scenario", async ({ scenario, reason, health, eventType }) => {
    const ctx = await setup("baseline");
    await withMonitorStorePatch(ctx.storePath, ctx.target.id, (t) => {
      t.watchedContentIds = [];
    });
    await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    const before = await readMonitorStore(ctx.storePath);
    const beforeTarget = before.targets.find((t) => t.id === ctx.target.id)!;
    const cursorBefore = structuredClone(beforeTarget.cursor);

    const next = withScenario(ctx, scenario);
    expect(next.deps.config.adapterCommand).toEqual(["node", fixturePath, "--scenario", scenario]);
    const result = await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);

    const after = await readMonitorStore(ctx.storePath);
    const afterTarget = after.targets.find((t) => t.id === ctx.target.id)!;
    expect(afterTarget.cursor.baselineEstablished).toBe(cursorBefore.baselineEstablished);
    expect(afterTarget.cursor.lastRunId).toBe(cursorBefore.lastRunId);
    expect(afterTarget.healthState).toBe(health);
    expect(after.events.some((e) => e.eventType === eventType)).toBe(true);
  });

  it("prevents concurrent runs for the same target", async () => {
    const ctx = await setup("new_content");
    process.env.FAKE_ADAPTER_SLEEP_MS = "300";
    const p1 = runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    await new Promise((r) => setTimeout(r, 50));
    const p2 = await runMonitorTargetJob({
      deps: { ...ctx.deps, ownerId: "other-owner" },
      targetId: ctx.target.id,
    });
    expect(p2.skipped).toBe(true);
    expect(p2.reason).toBe("lease_held");
    await p1;
  });

  it("retries outbox send failures", async () => {
    const ctx = await setup("baseline");
    await withMonitorStorePatch(ctx.storePath, ctx.target.id, (t) => {
      t.watchedContentIds = [];
    });
    await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    const next = withScenario(ctx, "new_content");
    await runMonitorTargetJob({ deps: next.deps, targetId: ctx.target.id });

    let attempts = 0;
    const flakyApi = {
      ...ctx.api,
      runtime: {
        channel: {
          telegram: {
            sendMessageTelegram: async () => {
              attempts += 1;
              if (attempts === 1) {
                throw new Error("network down");
              }
              return { ok: true };
            },
          },
        },
      },
    } as unknown as OpenClawPluginApi;

    const firstFlush = await flushOutbox({ api: flakyApi, storePath: ctx.storePath });
    expect(firstFlush.failed).toBe(1);
    const mid = await readMonitorStore(ctx.storePath);
    const row = mid.outbox[0]!;
    expect(row.status).toBe("retry");
    // Force due
    row.nextAttemptAt = new Date(0).toISOString();
    await fs.mkdir(path.dirname(ctx.storePath), { recursive: true });
    const { writeJsonFileAtomically } = await import("openclaw/plugin-sdk/media-monitor");
    await writeJsonFileAtomically(ctx.storePath, mid);

    const secondFlush = await flushOutbox({ api: flakyApi, storePath: ctx.storePath });
    expect(secondFlush.sent).toBe(1);
  });

  it("enforces tenant/agent isolation on run", async () => {
    const ctx = await setup("new_content");
    await expect(
      runMonitorTargetJob({
        deps: ctx.deps,
        targetId: ctx.target.id,
        tenantId: "other-tenant",
      }),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("recovers from sidecar timeout and non-zero exit without advancing cursor", async () => {
    const ctx = await setup("baseline");
    await withMonitorStorePatch(ctx.storePath, ctx.target.id, (t) => {
      t.watchedContentIds = [];
    });
    await runMonitorTargetJob({ deps: ctx.deps, targetId: ctx.target.id });
    const before = await readMonitorStore(ctx.storePath);
    const lastRun = before.targets[0]!.cursor.lastRunId;

    const failed = await runMonitorTargetJob({
      deps: withScenario(ctx, "fail_exit").deps,
      targetId: ctx.target.id,
    });
    expect(failed.ok).toBe(false);
    const afterFail = await readMonitorStore(ctx.storePath);
    expect(afterFail.targets[0]!.cursor.lastRunId).toBe(lastRun);

    const timedCtx = withScenario(ctx, "timeout");
    const timed = await runMonitorTargetJob({
      deps: {
        ...timedCtx.deps,
        config: { ...timedCtx.config, timeoutMs: 400 },
      },
      targetId: ctx.target.id,
    });
    expect(timed.ok).toBe(false);
    expect(timed.reason).toBe("timeout");
  });

  it("does not log cookie secret values via resolveCookie path", async () => {
    const ctx = await setup("new_content");
    await withMonitorStorePatch(ctx.storePath, ctx.target.id, (t) => {
      t.watchedContentIds = [];
    });
    const spy = vi.spyOn(ctx.api.logger, "warn");
    const result = await runMonitorTargetJob({
      deps: {
        ...ctx.deps,
        resolveCookie: () => "super-secret-cookie-value",
      },
      targetId: ctx.target.id,
    });
    expect(result.ok).toBe(true);
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("super-secret-cookie-value");
    spy.mockRestore();
  });
});
