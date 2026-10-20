import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLocalHttpWechatPersonalWorker,
  WECHAT_SIDECAR_LOOPBACK_ERROR,
} from "./local-http-worker.js";
import { isLoopbackHttpUrl } from "./loopback.js";
import { createNodeInvokeWechatPersonalWorker } from "./node-invoke-worker.js";
import { ensureLocalWechatSidecarRunning } from "./sidecar-spawn.js";
import {
  bindWechatPersonalNodeRegistry,
  createFailClosedWechatPersonalWorker,
  getBoundWechatPersonalNodeRegistry,
  getWechatPersonalWorker,
  isWechatPersonalWorkerInjected,
  WECHAT_WORKER_COMMANDS,
  type WechatPersonalWorker,
} from "./worker.js";

export const WECHAT_PERSONAL_CLOUD_NODE_REQUIRED =
  "WeChat personal needs an OpenBot desktop node on the computer that holds the session. A cloud Gateway cannot keep the protocol locally.";

export type WechatWorkerResolveOpts = {
  /**
   * When true, Gateway may talk to a loopback sidecar on THIS machine
   * (local-direct Gateway). Cloud / LIVE must leave this false.
   */
  allowLocalSidecar?: boolean;
  nodeRegistry?: {
    listConnected: () => Array<{
      nodeId: string;
      commands?: string[];
      platform?: string;
    }>;
    invoke: (p: {
      nodeId: string;
      command: string;
      params?: unknown;
      timeoutMs?: number;
    }) => Promise<{
      ok: boolean;
      payload?: unknown;
      payloadJSON?: string | null;
      error?: { code?: string; message?: string } | null;
    }>;
  };
};

export type WechatPersonalSidecarConfig = {
  proxyUrl: string;
  apiKey?: string;
  deviceType?: "ipad" | "mac";
  webhookPort?: number;
  webhookPath?: string;
  command?: string;
  args?: string[];
  cwd?: string | null;
};

function parseDeviceType(raw: unknown): "ipad" | "mac" | undefined {
  return raw === "ipad" || raw === "mac" ? raw : undefined;
}

function parseSidecarConfig(value: unknown): WechatPersonalSidecarConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.proxyUrl !== "string" || !record.proxyUrl.trim()) {
    return null;
  }
  const apiKey = typeof record.apiKey === "string" && record.apiKey ? record.apiKey : undefined;
  const webhookPort =
    typeof record.webhookPort === "number" && Number.isFinite(record.webhookPort)
      ? Math.trunc(record.webhookPort)
      : undefined;
  const webhookPath =
    typeof record.webhookPath === "string" && record.webhookPath.trim()
      ? record.webhookPath.trim()
      : undefined;
  const command =
    typeof record.command === "string" && record.command.trim() ? record.command.trim() : undefined;
  const args = Array.isArray(record.args)
    ? record.args.filter((item): item is string => typeof item === "string")
    : undefined;
  const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : undefined;
  return {
    proxyUrl: record.proxyUrl.trim(),
    apiKey,
    deviceType: parseDeviceType(record.deviceType),
    ...(webhookPort && webhookPort > 0 ? { webhookPort } : {}),
    ...(webhookPath ? { webhookPath } : {}),
    ...(command ? { command } : {}),
    ...(args && args.length > 0 ? { args } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

function readSidecarFile(filePath: string): WechatPersonalSidecarConfig | null {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    return parseSidecarConfig(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function requireLoopback(config: WechatPersonalSidecarConfig): WechatPersonalSidecarConfig {
  if (!isLoopbackHttpUrl(config.proxyUrl)) {
    throw new Error(WECHAT_SIDECAR_LOOPBACK_ERROR);
  }
  return config;
}

function homeSidecarCandidates(home: string): string[] {
  // OpenBot is the product path; ~/.openclaw is leftover-compat only.
  return [
    path.join(home, ".openbot", "wechat-personal-worker.json"),
    path.join(home, ".openclaw", "wechat-personal-worker.json"),
  ];
}

/**
 * Sidecar config from env or local files. Never reads channels.wechat.proxyUrl.
 * Throws if a configured proxyUrl is not loopback.
 * Primary file: ~/.openbot/wechat-personal-worker.json
 */
export function readWechatPersonalSidecarConfig(): WechatPersonalSidecarConfig | null {
  const envUrl = process.env.OPENBOT_WECHAT_PERSONAL_PROXY_URL?.trim();
  if (envUrl) {
    return requireLoopback({
      proxyUrl: envUrl,
      apiKey: process.env.OPENBOT_WECHAT_PERSONAL_API_KEY || undefined,
      deviceType: parseDeviceType(process.env.OPENBOT_WECHAT_PERSONAL_DEVICE_TYPE),
    });
  }

  const candidates: string[] = [];
  const workerFile = process.env.OPENBOT_WECHAT_PERSONAL_WORKER_FILE?.trim();
  if (workerFile) {
    candidates.push(workerFile);
  }
  const stateDir = process.env.OPENBOT_STATE_DIR?.trim();
  if (stateDir) {
    candidates.push(path.join(stateDir, "wechat-personal-worker.json"));
  }
  const home = os.homedir();
  if (home) {
    candidates.push(...homeSidecarCandidates(home));
  }

  for (const filePath of candidates) {
    const parsed = readSidecarFile(filePath);
    if (!parsed) {
      continue;
    }
    return requireLoopback(parsed);
  }
  return null;
}

function rankWechatNodes(
  nodes: Array<{ nodeId: string; commands?: string[]; platform?: string }>,
): Array<{ nodeId: string; commands?: string[]; platform?: string }> {
  const capable = nodes.filter((node) =>
    (node.commands ?? []).includes(WECHAT_WORKER_COMMANDS.probe),
  );
  return capable.toSorted((a, b) => {
    const aMac =
      (a.platform ?? "").toLowerCase().includes("darwin") ||
      (a.platform ?? "").toLowerCase().includes("mac")
        ? 0
        : 1;
    const bMac =
      (b.platform ?? "").toLowerCase().includes("darwin") ||
      (b.platform ?? "").toLowerCase().includes("mac")
        ? 0
        : 1;
    return aMac - bMac;
  });
}

/**
 * If any connected node advertises wechat.personal.probe, pin to it even when
 * the sidecar on that computer is currently offline. Cloud Gateway must not
 * fall through to the server's own loopback.
 */
async function resolveNodeWorker(
  nodeRegistry: NonNullable<WechatWorkerResolveOpts["nodeRegistry"]>,
): Promise<WechatPersonalWorker | null> {
  const ranked = rankWechatNodes(nodeRegistry.listConnected());
  let fallback: WechatPersonalWorker | null = null;
  for (const node of ranked) {
    const worker = createNodeInvokeWechatPersonalWorker({
      nodeId: node.nodeId,
      invoke: nodeRegistry.invoke,
    });
    fallback ??= worker;
    try {
      const probe = await worker.probe();
      if (probe.ok && probe.online) {
        return worker;
      }
    } catch {
      // Keep the first capable node as fallback.
    }
  }
  return fallback;
}

export { bindWechatPersonalNodeRegistry, getBoundWechatPersonalNodeRegistry } from "./worker.js";

export async function resolveWechatPersonalWorker(
  opts?: WechatWorkerResolveOpts,
): Promise<WechatPersonalWorker> {
  if (opts?.nodeRegistry) {
    bindWechatPersonalNodeRegistry(opts.nodeRegistry);
  }
  if (isWechatPersonalWorkerInjected()) {
    return getWechatPersonalWorker();
  }

  const nodeRegistry = opts?.nodeRegistry ?? getBoundWechatPersonalNodeRegistry();
  if (nodeRegistry) {
    const nodeWorker = await resolveNodeWorker(nodeRegistry);
    if (nodeWorker) {
      return nodeWorker;
    }
  }

  // Cloud / LIVE: never talk to loopback on the Gateway host.
  if (!opts?.allowLocalSidecar) {
    return createFailClosedWechatPersonalWorker(WECHAT_PERSONAL_CLOUD_NODE_REQUIRED);
  }

  const sidecar = readWechatPersonalSidecarConfig();
  if (sidecar) {
    const worker = createLocalHttpWechatPersonalWorker({
      proxyUrl: sidecar.proxyUrl,
      apiKey: sidecar.apiKey,
      deviceType: sidecar.deviceType,
    });
    try {
      const probe = await ensureLocalWechatSidecarRunning({
        spec: sidecar,
        probe: () => worker.probe(),
      });
      if (probe.online) {
        return worker;
      }
    } catch {
      // Fall through to fail-closed.
    }
  }

  return createFailClosedWechatPersonalWorker();
}
