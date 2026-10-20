/**
 * Optional smoke: real openbot-media-adapter + local_bridge cache.
 * Skips unless MEDIA_MONITOR_BRIDGE_SMOKE=1 and bridge /v1/health has creator cache.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginConfig } from "./config.js";
import { runMonitorTargetJob } from "./job-runner.js";
import { readMonitorStore, resolveMonitorStorePath } from "./monitor-store.js";
import { addMonitorTarget } from "./targets.js";

const enabled = process.env.MEDIA_MONITOR_BRIDGE_SMOKE === "1";
const adapterRoot =
  process.env.OPENBOT_MEDIA_ADAPTER_ROOT || path.resolve(process.cwd(), "../openbot-media-adapter");
const pythonBin = path.join(adapterRoot, ".venv/bin/python");
const bridgeUrl = process.env.XHS_BRIDGE_URL || "http://127.0.0.1:8765";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function readBridgeHealth(): Promise<{
  ok: boolean;
  cache: Array<{ key: string; kind: string }>;
} | null> {
  try {
    const res = await fetch(`${bridgeUrl}/v1/health`);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as { ok: boolean; cache: Array<{ key: string; kind: string }> };
  } catch {
    return null;
  }
}

describe.skipIf(!enabled)("media-monitor bridge e2e smoke", () => {
  it("baselines a real creator crawl via bridge cache", async () => {
    await fs.access(pythonBin);
    const health = await readBridgeHealth();
    expect(health?.ok).toBe(true);
    const creator = (health?.cache || []).find((c) => c.kind === "creator");
    expect(creator, "open a Xiaohongshu profile with the harvest extension first").toBeTruthy();
    const accountId = creator!.key.replace(/^creator:/, "");

    process.env.OPENBOT_MEDIA_ADAPTER_MODE = "live";
    process.env.OPENBOT_MEDIA_XHS_TRANSPORT = "bridge";
    process.env.XHS_BRIDGE_URL = bridgeUrl;
    process.env.XHS_CREATOR_URL_TEMPLATE =
      "https://edith.xiaohongshu.com/api/sns/web/v1/user_posted?num=30&cursor={cursor}&user_id={account_id}&image_formats=jpg,webp,avif&xsec_token={xsec_token}&xsec_source=pc_search";

    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-monitor-bridge-"));
    tempDirs.push(stateDir);
    const storePath = resolveMonitorStorePath(stateDir);
    const api = {
      id: "media-monitor",
      runtime: { channel: {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    } as unknown as OpenClawPluginApi;

    const config = resolvePluginConfig({
      adapterCommand: [pythonBin, "-m", "openbot_media_adapter"],
      adapterCwd: adapterRoot,
      defaultPollIntervalSeconds: 1800,
      timeoutMs: 60_000,
    });

    const suffix = crypto.randomBytes(3).toString("hex");
    const target = await addMonitorTarget({
      storePath,
      config,
      input: {
        tenantId: `tenant-${suffix}`,
        agentId: `agent-${suffix}`,
        accountId,
        accountUrl: `https://www.xiaohongshu.com/user/profile/${accountId}`,
        displayName: "bridge-smoke",
      },
    });

    const first = await runMonitorTargetJob({
      deps: {
        api,
        storePath,
        config,
        ownerId: `smoke-${suffix}`,
        resolveCookie: () => "bridge",
      },
      targetId: target.id,
      tenantId: target.tenantId,
      agentId: target.agentId,
    });
    expect(first.ok).toBe(true);

    const store = await readMonitorStore(storePath);
    const events = store.events.filter((e) => e.targetId === target.id);
    // First success is baseline — no content.created flood required.
    expect(events.some((e) => e.eventType === "monitor.failed")).toBe(false);
  }, 60_000);
});
