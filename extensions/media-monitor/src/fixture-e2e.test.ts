/**
 * Default-on e2e: fake adapter sidecar through job-runner (no real platform / cookie).
 * Real bridge smoke remains opt-in via MEDIA_MONITOR_BRIDGE_SMOKE=1.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginConfig } from "./config.js";
import { runMonitorTargetJob } from "./job-runner.js";
import { readMonitorStore, resolveMonitorStorePath } from "./monitor-store.js";
import { addMonitorTarget } from "./targets.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-adapter.mjs",
);

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("media-monitor fake-adapter e2e", () => {
  it("baselines then detects new content without platform credentials", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-monitor-fixture-e2e-"));
    tempDirs.push(stateDir);
    const storePath = resolveMonitorStorePath(stateDir);
    const api = {
      id: "media-monitor",
      runtime: { channel: {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    } as unknown as OpenClawPluginApi;

    const config = resolvePluginConfig({
      adapterCommand: ["node", fixturePath, "--scenario", "baseline"],
      defaultPollIntervalSeconds: 60,
      timeoutMs: 15_000,
    });

    const suffix = crypto.randomBytes(3).toString("hex");
    const target = await addMonitorTarget({
      storePath,
      config,
      input: {
        tenantId: `tenant-${suffix}`,
        agentId: `agent-${suffix}`,
        accountId: `acct-${suffix}`,
        accountUrl: `https://www.xiaohongshu.com/user/profile/acct-${suffix}`,
        displayName: "fixture-e2e",
        watchedContentIds: [],
      },
    });

    const deps = {
      api,
      storePath,
      config,
      ownerId: `e2e-${suffix}`,
      resolveCookie: () => undefined,
    };

    const baseline = await runMonitorTargetJob({
      deps,
      targetId: target.id,
      tenantId: target.tenantId,
      agentId: target.agentId,
    });
    expect(baseline.ok).toBe(true);

    const afterBaseline = await readMonitorStore(storePath);
    expect(afterBaseline.targets[0]?.cursor.baselineEstablished).toBe(true);
    expect(afterBaseline.events.some((e) => e.eventType === "content.created")).toBe(true);
    expect(afterBaseline.outbox).toHaveLength(0);

    const freshConfig = resolvePluginConfig({
      adapterCommand: ["node", fixturePath, "--scenario", "new_content"],
      defaultPollIntervalSeconds: 60,
      timeoutMs: 15_000,
      notifyChannel: "telegram",
      notifyTo: "chat-1",
    });
    await runMonitorTargetJob({
      deps: { ...deps, config: freshConfig },
      targetId: target.id,
      tenantId: target.tenantId,
      agentId: target.agentId,
    });

    const afterNew = await readMonitorStore(storePath);
    expect(afterNew.events.some((e) => e.eventType === "content.created")).toBe(true);
    expect(afterNew.outbox.length).toBeGreaterThan(0);
    expect(afterNew.outbox.every((row) => row.tenantId === target.tenantId)).toBe(true);
  });
});
