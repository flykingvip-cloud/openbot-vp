/**
 * Multi-process gateway e2e: spawn a real gateway child, hit POST /tools/invoke
 * for memory_search / memory_get over a live loopback socket.
 *
 * Prefer tip source via `node --import tsx src/entry.ts` so memory continuity
 * landing code is exercised without requiring a full dist rebuild. Falls back
 * documentation in acceptance.md if spawn is blocked by env.
 *
 * Covers authorized DM marker round-trip. Group authz denials are covered by
 * the live HTTP listen harness (src/memory/memory-continuity-gateway.http.integration.test.ts)
 * which injects session identity at the auth boundary; full child-process
 * trusted-proxy identity for group membership remains a documented gap when
 * platform auth store is unavailable in minimal gateway mode.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../src/config/config.js";
// Import embedding mocks before manager helpers so vi.mock binds.
import { resetEmbeddingMocks } from "../src/memory/embedding.test-mocks.js";
import { closeAllMemoryIndexManagers } from "../src/memory/manager-runtime.js";
import { getRequiredMemoryIndexManager } from "../src/memory/test-manager-helpers.js";
import { sleep } from "../src/utils.js";

const GATEWAY_START_TIMEOUT_MS = 90_000;
const GATEWAY_STOP_TIMEOUT_MS = 2_000;

type MemGatewayInstance = {
  port: number;
  gatewayToken: string;
  homeDir: string;
  workspaceDir: string;
  child: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
};

const getFreePort = async () => {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const addr = srv.address();
  if (!addr || typeof addr === "string") {
    srv.close();
    throw new Error("failed to bind ephemeral port");
  }
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return addr.port;
};

async function waitForPortOpen(
  proc: ChildProcessWithoutNullStreams,
  chunksOut: string[],
  chunksErr: string[],
  port: number,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(
        `gateway exited before listening (code=${String(proc.exitCode)} signal=${String(proc.signalCode)})\n` +
          `--- stdout ---\n${chunksOut.join("")}\n--- stderr ---\n${chunksErr.join("")}`,
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", (err) => {
          socket.destroy();
          reject(err);
        });
      });
      return;
    } catch {
      // keep polling
    }
    await sleep(50);
  }
  throw new Error(
    `timeout waiting for gateway to listen on port ${port}\n` +
      `--- stdout ---\n${chunksOut.join("")}\n--- stderr ---\n${chunksErr.join("")}`,
  );
}

async function spawnMemoryGateway(params: {
  name: string;
  markerFileRel: string;
  markerBody: string;
}): Promise<MemGatewayInstance> {
  const port = await getFreePort();
  const gatewayToken = `gw-mem-${params.name}-${randomUUID()}`;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), `openbot-mem-e2e-${params.name}-`));
  const configDir = path.join(homeDir, ".openbot");
  await fs.mkdir(configDir, { recursive: true });
  const stateDir = path.join(configDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const workspaceDir = path.join(homeDir, "workspace");
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, params.markerFileRel), params.markerBody, "utf8");

  const indexPath = path.join(stateDir, "memory-index.sqlite");
  const configPath = path.join(configDir, "openbot.json");
  const config = {
    gateway: {
      port,
      bind: "loopback",
      auth: { mode: "token", token: gatewayToken },
      controlUi: { enabled: false },
      tools: { allow: ["memory_search", "memory_get"] },
    },
    agents: {
      defaults: {
        workspace: workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: indexPath, vector: { enabled: false } },
          cache: { enabled: false },
          query: { minScore: 0, hybrid: { enabled: true, vectorWeight: 0, textWeight: 1 } },
          sync: { watch: false, onSessionStart: false, onSearch: false },
        },
      },
      list: [
        {
          id: "main",
          default: true,
        },
      ],
    },
    plugins: {
      enabled: true,
      slots: { memory: "memory-core" },
    },
  };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  // Pre-index in the parent so the child gateway can search a warm sqlite.
  // Search-triggered sync in a fresh child is fail-closed until v1 roots are
  // registered; unit/HTTP harnesses call registerIsolatedTestV1Root — e2e does
  // the equivalent via getRequiredMemoryIndexManager + force sync, then closes
  // managers so the child can open the same index path.
  const seedCfg = {
    agents: {
      defaults: {
        workspace: workspaceDir,
        memorySearch: config.agents.defaults.memorySearch,
      },
      list: [{ id: "main", default: true }],
    },
  } as OpenBotConfig;
  resetEmbeddingMocks();
  const markerQuery =
    params.markerBody
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("continuitye2e")) ?? params.markerBody.trim();
  const seedManager = await getRequiredMemoryIndexManager({ cfg: seedCfg, agentId: "main" });
  await seedManager.sync({ reason: "test", force: true });
  const seedStatus = seedManager.status();
  const seedHits = await seedManager.search(markerQuery, {
    maxResults: 10,
    minScore: 0,
  });
  if (seedHits.length === 0) {
    await closeAllMemoryIndexManagers().catch(() => undefined);
    await fs.rm(homeDir, { recursive: true, force: true });
    throw new Error(
      `e2e pre-index produced zero hits for marker=${markerQuery} status=${JSON.stringify(seedStatus)}`,
    );
  }
  await closeAllMemoryIndexManagers().catch(() => undefined);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/entry.ts",
      "gateway",
      "--port",
      String(port),
      "--bind",
      "loopback",
      "--allow-unconfigured",
    ],
    {
      cwd: process.cwd(),
      env: (() => {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          OPENBOT_CONFIG_PATH: configPath,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENBOT_STATE_DIR: stateDir,
          OPENCLAW_STATE_DIR: stateDir,
          OPENBOT_GATEWAY_TOKEN: "",
          OPENCLAW_GATEWAY_TOKEN: "",
          OPENCLAW_GATEWAY_PASSWORD: "",
          OPENCLAW_SKIP_CHANNELS: "1",
          OPENCLAW_SKIP_PROVIDERS: "1",
          OPENCLAW_SKIP_GMAIL_WATCHER: "1",
          OPENCLAW_SKIP_CRON: "1",
          OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
          OPENCLAW_SKIP_CANVAS_HOST: "1",
          OPENCLAW_TEST_MINIMAL_GATEWAY: "1",
          // Do NOT set VITEST — would disable memory slot defaults in the child.
          OPENCLAW_RUNNER_LOG: "0",
        };
        // Force FTS-only: missing API keys → null embedding provider.
        delete env.OPENAI_API_KEY;
        delete env.OPENAI_API_KEYS;
        delete env.ANTHROPIC_API_KEY;
        delete env.GEMINI_API_KEY;
        delete env.GOOGLE_API_KEY;
        delete env.VOYAGE_API_KEY;
        delete env.MISTRAL_API_KEY;
        delete env.VITEST;
        return env;
      })(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  void tsxBin;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (d) => stdout.push(String(d)));
  child.stderr?.on("data", (d) => stderr.push(String(d)));

  try {
    await waitForPortOpen(child, stdout, stderr, port, GATEWAY_START_TIMEOUT_MS);
  } catch (err) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    await fs.rm(homeDir, { recursive: true, force: true });
    throw err;
  }

  return { port, gatewayToken, homeDir, workspaceDir, child, stdout, stderr };
}

async function stopMemoryGateway(inst: MemGatewayInstance) {
  if (inst.child.exitCode === null && !inst.child.killed) {
    try {
      inst.child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      if (inst.child.exitCode !== null) {
        return resolve(true);
      }
      inst.child.once("exit", () => resolve(true));
    }),
    sleep(GATEWAY_STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (!exited && inst.child.exitCode === null && !inst.child.killed) {
    try {
      inst.child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  await fs.rm(inst.homeDir, { recursive: true, force: true });
}

async function postToolsInvoke(
  inst: MemGatewayInstance,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port: inst.port,
        path: "/tools/invoke",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          authorization: `Bearer ${inst.gatewayToken}`,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = data.trim() ? (JSON.parse(data) as Record<string, unknown>) : {};
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("memory continuity multi-process gateway e2e", () => {
  let instance: MemGatewayInstance | null = null;

  afterEach(async () => {
    if (instance) {
      await stopMemoryGateway(instance);
      instance = null;
    }
  });

  it("child gateway: authorized DM marker via HTTP memory_search / memory_get", async () => {
    // FTS keeps underscore ids as one token; extractKeywords splits on \p{P} and
    // would miss. Use a single alphanumeric token both paths share.
    const marker = `continuitye2e${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
    const relPath = "memory/continuity-dm-e2e.md";
    instance = await spawnMemoryGateway({
      name: "dm",
      markerFileRel: relPath,
      markerBody: `# e2e\n${marker}\n`,
    });

    // Prove workspace resolution via memory_get (file read, no index).
    const gotProbe = await postToolsInvoke(instance, {
      tool: "memory_get",
      args: { path: relPath },
      sessionKey: "agent:main:main",
    });
    expect(gotProbe.status, `get probe status stderr=${instance.stderr.join("")}`).toBe(200);
    expect(gotProbe.json.ok).toBe(true);
    expect(
      JSON.stringify(gotProbe.json),
      `get probe body=${JSON.stringify(gotProbe.json)} stderr=${instance.stderr.slice(-20).join("")}`,
    ).toContain(marker);

    // Warm sqlite from parent; short poll in case child needs a moment to open db.
    let search: { status: number; json: Record<string, unknown> } | null = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      search = await postToolsInvoke(instance, {
        tool: "memory_search",
        args: { query: marker, maxResults: 10, minScore: 0 },
        sessionKey: "agent:main:main",
      });
      if (search.status === 200 && search.json.ok === true) {
        const body = JSON.stringify(search.json);
        if (body.includes(marker)) {
          break;
        }
      }
      await sleep(250);
    }
    expect(search, "search response").toBeTruthy();
    expect(search!.status).toBe(200);
    expect(search!.json.ok).toBe(true);
    expect(
      JSON.stringify(search!.json),
      `search body=${JSON.stringify(search!.json)} stderr=${instance.stderr.slice(-40).join("")}`,
    ).toContain(marker);

    const got = await postToolsInvoke(instance, {
      tool: "memory_get",
      args: { path: relPath },
      sessionKey: "agent:main:main",
    });
    expect(got.status).toBe(200);
    expect(got.json.ok).toBe(true);
    expect(JSON.stringify(got.json)).toContain(marker);
  }, 120_000);
});
