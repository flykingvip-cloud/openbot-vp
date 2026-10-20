import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalHttpWechatPersonalWorker,
  WECHAT_SIDECAR_LOOPBACK_ERROR,
} from "./local-http-worker.js";
import { isLoopbackHttpUrl } from "./loopback.js";
import { createNodeInvokeWechatPersonalWorker } from "./node-invoke-worker.js";
import {
  readWechatPersonalSidecarConfig,
  resolveWechatPersonalWorker,
  WECHAT_PERSONAL_CLOUD_NODE_REQUIRED,
} from "./resolve-worker.js";
import {
  createMemoryWechatPersonalWorker,
  isWechatPersonalWorkerInjected,
  resetWechatPersonalWorker,
  setWechatPersonalWorker,
  WECHAT_WORKER_COMMANDS,
} from "./worker.js";

const QR_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SIDECAR_ENV_KEYS = [
  "OPENBOT_WECHAT_PERSONAL_PROXY_URL",
  "OPENBOT_WECHAT_PERSONAL_API_KEY",
  "OPENBOT_WECHAT_PERSONAL_DEVICE_TYPE",
  "OPENBOT_WECHAT_PERSONAL_WORKER_FILE",
  "OPENBOT_STATE_DIR",
  "HOME",
] as const;

type EnvSnapshot = Record<(typeof SIDECAR_ENV_KEYS)[number], string | undefined>;

function snapshotEnv(): EnvSnapshot {
  const snapshot = {} as EnvSnapshot;
  for (const key of SIDECAR_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of SIDECAR_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function isolateSidecarEnv(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "openbot-wechat-home-"));
  delete process.env.OPENBOT_WECHAT_PERSONAL_PROXY_URL;
  delete process.env.OPENBOT_WECHAT_PERSONAL_API_KEY;
  delete process.env.OPENBOT_WECHAT_PERSONAL_DEVICE_TYPE;
  delete process.env.OPENBOT_WECHAT_PERSONAL_WORKER_FILE;
  delete process.env.OPENBOT_STATE_DIR;
  process.env.HOME = home;
  return home;
}

type SidecarState = {
  status: "logged_out" | "qr_pending" | "scanning" | "confirming" | "logged_in";
  qrCodeUrl?: string;
  wxid?: string;
  nickname?: string;
  loginPolls: number;
  lastAuth?: string;
  sent: Array<{ to: string; content: string }>;
  healthHits: number;
  loginStatusHits: number;
  healthMode?: "none" | "ok" | "send_not_ready" | "unauthorized";
  sendMode?:
    | "legacy"
    | "delivered"
    | "submitted_unconfirmed"
    | "status_unknown"
    | "failed_200"
    | "ambiguous_409";
};

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return address.port;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startMockSidecar(opts?: { requireAuth?: boolean }): Promise<{
  url: string;
  state: SidecarState;
  close: () => Promise<void>;
}> {
  const state: SidecarState = {
    status: "logged_out",
    loginPolls: 0,
    sent: [],
    healthHits: 0,
    loginStatusHits: 0,
    healthMode: "none",
    sendMode: "legacy",
  };
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    state.lastAuth =
      typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
    if (opts?.requireAuth && req.headers.authorization !== "Bearer test-key") {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    void (async () => {
      if (req.method === "GET" && url.startsWith("/api/health")) {
        state.healthHits += 1;
        if (state.healthMode === "none") {
          json(res, 404, { error: "not found" });
          return;
        }
        if (state.healthMode === "unauthorized") {
          json(res, 401, { error: "unauthorized" });
          return;
        }
        json(res, 200, {
          ok: true,
          contract: "vnext",
          sendReady: state.healthMode !== "send_not_ready",
        });
        return;
      }
      if (req.method === "GET" && url.startsWith("/api/loginStatus")) {
        state.loginStatusHits += 1;
        state.loginPolls += 1;
        if (state.status === "qr_pending" && state.loginPolls >= 2) {
          state.status = "logged_in";
          state.wxid = "wxid_abc123";
          state.nickname = "Test Nick";
        }
        json(res, 200, {
          status: state.status,
          qrCodeUrl: state.qrCodeUrl,
          wxid: state.wxid,
          nickname: state.nickname,
        });
        return;
      }
      if (req.method === "POST" && url.startsWith("/api/login")) {
        await readBody(req);
        state.status = "qr_pending";
        state.qrCodeUrl = QR_DATA_URL;
        state.loginPolls = 0;
        json(res, 200, { qrCodeUrl: QR_DATA_URL, loginId: "sid-1" });
        return;
      }
      if (req.method === "POST" && url.startsWith("/api/logout")) {
        state.status = "logged_out";
        state.wxid = undefined;
        state.nickname = undefined;
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url.startsWith("/api/sendTextMsg")) {
        const body = JSON.parse(await readBody(req)) as { to?: string; content?: string };
        state.sent.push({ to: body.to ?? "", content: body.content ?? "" });
        if (state.sendMode === "ambiguous_409") {
          json(res, 409, {
            ok: false,
            status: "ambiguous",
            hint: "multiple contacts match",
            candidates: [{ id: "a" }, { id: "b" }],
          });
          return;
        }
        if (state.sendMode === "failed_200") {
          json(res, 200, {
            ok: false,
            status: "failed",
            diagnostic: { code: "SEND_FAILED", detail: "native reject" },
          });
          return;
        }
        if (state.sendMode === "delivered") {
          json(res, 200, { ok: true, status: "delivered", msgId: "msg-1" });
          return;
        }
        if (state.sendMode === "submitted_unconfirmed") {
          json(res, 200, { ok: true, status: "submitted_unconfirmed", msgId: "msg-1" });
          return;
        }
        if (state.sendMode === "status_unknown") {
          json(res, 200, { ok: true, status: "status_unknown", msgId: "msg-1" });
          return;
        }
        json(res, 200, { msgId: "msg-1" });
        return;
      }
      json(res, 404, { error: "not found" });
    })().catch(() => {
      json(res, 500, { error: "internal" });
    });
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("wechat personal real login chain", () => {
  const envSnapshot = snapshotEnv();
  const tempDirs: string[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    resetWechatPersonalWorker();
    restoreEnv(envSnapshot);
    while (closers.length > 0) {
      const close = closers.pop();
      if (close) {
        await close();
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("isLoopbackHttpUrl accepts loopback and rejects remote hosts", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackHttpUrl("http://localhost/api")).toBe(true);
    expect(isLoopbackHttpUrl("https://[::1]/")).toBe(true);
    expect(isLoopbackHttpUrl("http://example.com")).toBe(false);
    expect(isLoopbackHttpUrl("http://10.0.0.1")).toBe(false);
    expect(isLoopbackHttpUrl("https://wechat.example")).toBe(false);
    expect(isLoopbackHttpUrl("ftp://127.0.0.1")).toBe(false);
    expect(isLoopbackHttpUrl("not a url")).toBe(false);
  });

  it("createLocalHttpWechatPersonalWorker throws when proxyUrl is not loopback", () => {
    expect(() =>
      createLocalHttpWechatPersonalWorker({ proxyUrl: "http://example.com:3000" }),
    ).toThrow(/loopback/i);
    expect(() => createLocalHttpWechatPersonalWorker({ proxyUrl: "http://10.0.0.1" })).toThrow(
      WECHAT_SIDECAR_LOOPBACK_ERROR,
    );
  });

  it("loopback worker probe/loginStart/loginWait/status against mock sidecar", async () => {
    const sidecar = await startMockSidecar();
    closers.push(sidecar.close);
    const worker = createLocalHttpWechatPersonalWorker({
      proxyUrl: sidecar.url,
      apiKey: "test-key",
      sleep: async () => {},
    });

    const probe = await worker.probe();
    expect(probe).toEqual({ ok: true, online: true });

    const started = await worker.loginStart({ accountId: "default" });
    expect(started.qrDataUrl).toBe(QR_DATA_URL);
    expect(started.loginId).toBe("sid-1");

    const waited = await worker.loginWait({ accountId: "default", timeoutMs: 3_000 });
    expect(waited.connected).toBe(true);
    expect(waited.status).toBe("logged_in");
    expect(waited.wxid).toBe("wxid_abc123");
    expect(waited.nickname).toBe("Test Nick");

    const status = await worker.status({ accountId: "default" });
    expect(status).toMatchObject({
      online: true,
      loggedIn: true,
      wxid: "wxid_abc123",
      nickname: "Test Nick",
    });

    const sent = await worker.sendText?.({ accountId: "default", to: "filehelper", text: "hi" });
    expect(sent).toEqual({ messageId: "msg-1" });
    expect(sidecar.state.sent).toEqual([{ to: "filehelper", content: "hi" }]);
    expect(sidecar.state.lastAuth).toBe("Bearer test-key");
  });

  it("probe is online:false on connection errors and unauthorized on 401", async () => {
    const workerOffline = createLocalHttpWechatPersonalWorker({
      proxyUrl: "http://127.0.0.1:1",
    });
    const offline = await workerOffline.probe();
    expect(offline.ok).toBe(false);
    expect(offline.online).toBe(false);

    const sidecar = await startMockSidecar({ requireAuth: true });
    closers.push(sidecar.close);
    const unauthorized = createLocalHttpWechatPersonalWorker({
      proxyUrl: sidecar.url,
    });
    const probe = await unauthorized.probe();
    expect(probe).toMatchObject({ ok: false, online: true, error: "unauthorized" });
  });

  it("logout treats 404 as cleared:false", async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/api/loginStatus")) {
        json(res, 200, { status: "logged_out" });
        return;
      }
      json(res, 404, { error: "missing" });
    });
    const port = await listen(server);
    closers.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    );
    const worker = createLocalHttpWechatPersonalWorker({
      proxyUrl: `http://127.0.0.1:${port}`,
    });
    await expect(worker.logout({ accountId: "default" })).resolves.toEqual({ cleared: false });
  });

  it("resolveWechatPersonalWorker with no env/file/node and no injection is fail-closed", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    expect(isWechatPersonalWorkerInjected()).toBe(false);
    const worker = await resolveWechatPersonalWorker();
    const probe = await worker.probe();
    expect(probe.ok).toBe(false);
    expect(probe.online).toBe(false);
    expect(probe.error).toBe(WECHAT_PERSONAL_CLOUD_NODE_REQUIRED);
    await expect(worker.loginStart({ accountId: "default" })).rejects.toThrow(
      WECHAT_PERSONAL_CLOUD_NODE_REQUIRED,
    );
  });

  it("resolve with injected memory worker wins over missing sidecar", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    const memory = createMemoryWechatPersonalWorker({ wxid: "wxid_mem" });
    setWechatPersonalWorker(memory);
    const worker = await resolveWechatPersonalWorker();
    expect(await worker.probe()).toEqual({ ok: true, online: true });
    const started = await worker.loginStart({ accountId: "default" });
    expect(started.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("createNodeInvokeWechatPersonalWorker maps probe/loginStart via invoke", async () => {
    const calls: Array<{ command: string; timeoutMs?: number }> = [];
    const worker = createNodeInvokeWechatPersonalWorker({
      nodeId: "mac-1",
      invoke: async ({ command, timeoutMs }) => {
        calls.push({ command, timeoutMs });
        if (command === WECHAT_WORKER_COMMANDS.probe) {
          return { ok: true, payload: { ok: true, online: true } };
        }
        if (command === WECHAT_WORKER_COMMANDS.loginStart) {
          return {
            ok: true,
            payloadJSON: JSON.stringify({ qrDataUrl: QR_DATA_URL, loginId: "node-1" }),
          };
        }
        if (command === WECHAT_WORKER_COMMANDS.loginWait) {
          return {
            ok: true,
            payload: {
              connected: true,
              status: "logged_in",
              wxid: "wxid_node",
              nickname: "Node",
              message: "Logged in as wxid_node",
            },
          };
        }
        return { ok: false, error: { message: "unexpected" } };
      },
    });
    expect(await worker.probe()).toEqual({ ok: true, online: true });
    const started = await worker.loginStart({ accountId: "default" });
    expect(started).toEqual({ qrDataUrl: QR_DATA_URL, loginId: "node-1" });
    const waited = await worker.loginWait({ accountId: "default", timeoutMs: 45_000 });
    expect(waited.wxid).toBe("wxid_node");
    expect(calls.map((c) => c.command)).toEqual([
      WECHAT_WORKER_COMMANDS.probe,
      WECHAT_WORKER_COMMANDS.loginStart,
      WECHAT_WORKER_COMMANDS.loginWait,
    ]);
    expect(calls[2]?.timeoutMs).toBe(45_000);
  });

  it("node invoke loginStart throws when invoke is not ok", async () => {
    const worker = createNodeInvokeWechatPersonalWorker({
      nodeId: "mac-1",
      invoke: async () => ({ ok: false, error: { message: "node down" } }),
    });
    await expect(worker.loginStart({ accountId: "default" })).rejects.toThrow("node down");
    const probe = await worker.probe();
    expect(probe).toMatchObject({ ok: false, online: false, error: "node down" });
  });

  it("resolve rejects non-loopback env URL", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    process.env.OPENBOT_WECHAT_PERSONAL_PROXY_URL = "http://example.com:3000";
    expect(() => readWechatPersonalSidecarConfig()).toThrow(/loopback/i);
    await expect(resolveWechatPersonalWorker({ allowLocalSidecar: true })).rejects.toThrow(
      /loopback/i,
    );
  });

  it("resolve uses a connected node advertising wechat.personal.probe", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    const worker = await resolveWechatPersonalWorker({
      nodeRegistry: {
        listConnected: () => [{ nodeId: "mac-1", commands: [WECHAT_WORKER_COMMANDS.probe] }],
        invoke: async ({ command }) => {
          if (command === WECHAT_WORKER_COMMANDS.probe) {
            return { ok: true, payload: { ok: true, online: true } };
          }
          return { ok: false, error: { message: "unused" } };
        },
      },
    });
    expect(await worker.probe()).toEqual({ ok: true, online: true });
  });

  it("readWechatPersonalSidecarConfig reads loopback file under HOME", () => {
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    const dir = path.join(home, ".openbot");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "wechat-personal-worker.json"),
      JSON.stringify({ proxyUrl: "http://127.0.0.1:3000", apiKey: "file-key", deviceType: "mac" }),
      "utf8",
    );
    expect(readWechatPersonalSidecarConfig()).toEqual({
      proxyUrl: "http://127.0.0.1:3000",
      apiKey: "file-key",
      deviceType: "mac",
    });
  });

  it("readWechatPersonalSidecarConfig reads optional command args cwd", () => {
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    const dir = path.join(home, ".openbot");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "wechat-personal-worker.json"),
      JSON.stringify({
        proxyUrl: "http://127.0.0.1:3000",
        command: "/opt/sidecar",
        args: ["--listen"],
        cwd: null,
      }),
      "utf8",
    );
    expect(readWechatPersonalSidecarConfig()).toEqual({
      proxyUrl: "http://127.0.0.1:3000",
      command: "/opt/sidecar",
      args: ["--listen"],
    });
  });

  it("prefers ~/.openbot over leftover ~/.openclaw sidecar file", () => {
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    mkdirSync(path.join(home, ".openclaw"), { recursive: true });
    mkdirSync(path.join(home, ".openbot"), { recursive: true });
    writeFileSync(
      path.join(home, ".openclaw", "wechat-personal-worker.json"),
      JSON.stringify({ proxyUrl: "http://127.0.0.1:3001", apiKey: "claw" }),
      "utf8",
    );
    writeFileSync(
      path.join(home, ".openbot", "wechat-personal-worker.json"),
      JSON.stringify({ proxyUrl: "http://127.0.0.1:3000", apiKey: "openbot" }),
      "utf8",
    );
    expect(readWechatPersonalSidecarConfig()).toEqual({
      proxyUrl: "http://127.0.0.1:3000",
      apiKey: "openbot",
    });
  });

  it("cloud Gateway does not use a local sidecar even if one is configured", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    mkdirSync(path.join(home, ".openbot"), { recursive: true });
    writeFileSync(
      path.join(home, ".openbot", "wechat-personal-worker.json"),
      JSON.stringify({ proxyUrl: "http://127.0.0.1:3000" }),
      "utf8",
    );
    const worker = await resolveWechatPersonalWorker();
    const probe = await worker.probe();
    expect(probe.online).toBe(false);
    expect(probe.error).toBe(WECHAT_PERSONAL_CLOUD_NODE_REQUIRED);
  });

  it("local-direct Gateway may use the loopback sidecar", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    const sidecar = await startMockSidecar();
    closers.push(sidecar.close);
    process.env.OPENBOT_WECHAT_PERSONAL_PROXY_URL = sidecar.url;
    const worker = await resolveWechatPersonalWorker({ allowLocalSidecar: true });
    expect(await worker.probe()).toEqual({ ok: true, online: true });
  });

  it("does not spawn sidecar command on cloud Gateway", async () => {
    const { setWechatSidecarSpawnForTests, resetWechatSidecarSpawnForTests } =
      await import("./sidecar-spawn.js");
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    mkdirSync(path.join(home, ".openbot"), { recursive: true });
    writeFileSync(
      path.join(home, ".openbot", "wechat-personal-worker.json"),
      JSON.stringify({
        proxyUrl: "http://127.0.0.1:1",
        command: "/opt/sidecar",
      }),
      "utf8",
    );
    const launches: string[] = [];
    setWechatSidecarSpawnForTests((spec) => {
      launches.push(spec.command);
      return true;
    });
    try {
      const worker = await resolveWechatPersonalWorker();
      const probe = await worker.probe();
      expect(probe.online).toBe(false);
      expect(launches).toEqual([]);
    } finally {
      resetWechatSidecarSpawnForTests();
    }
  });

  it("pins a connected wechat node even when its sidecar probe is offline", async () => {
    resetWechatPersonalWorker();
    const home = isolateSidecarEnv();
    tempDirs.push(home);
    process.env.OPENBOT_WECHAT_PERSONAL_PROXY_URL = "http://127.0.0.1:3000";
    const worker = await resolveWechatPersonalWorker({
      allowLocalSidecar: true,
      nodeRegistry: {
        listConnected: () => [
          { nodeId: "mac-1", platform: "darwin", commands: [WECHAT_WORKER_COMMANDS.probe] },
        ],
        invoke: async () => ({ ok: false, error: { message: "sidecar offline on node" } }),
      },
    });
    const probe = await worker.probe();
    expect(probe).toMatchObject({ ok: false, online: false, error: "sidecar offline on node" });
  });

  it("probe prefers /api/health and falls back to loginStatus on 404", async () => {
    const sidecar = await startMockSidecar();
    closers.push(sidecar.close);
    sidecar.state.healthMode = "none";
    const worker = createLocalHttpWechatPersonalWorker({
      proxyUrl: sidecar.url,
      sleep: async () => {},
    });
    const probe = await worker.probe();
    expect(probe).toEqual({ ok: true, online: true });
    expect(sidecar.state.healthHits).toBe(1);
    expect(sidecar.state.loginStatusHits).toBe(1);

    sidecar.state.healthMode = "ok";
    sidecar.state.healthHits = 0;
    sidecar.state.loginStatusHits = 0;
    const healthProbe = await worker.probe();
    expect(healthProbe).toEqual({ ok: true, online: true });
    expect(sidecar.state.healthHits).toBe(1);
    expect(sidecar.state.loginStatusHits).toBe(0);
  });

  it("probe soft-warns on sendReady:false without marking offline", async () => {
    const sidecar = await startMockSidecar();
    closers.push(sidecar.close);
    sidecar.state.healthMode = "send_not_ready";
    const worker = createLocalHttpWechatPersonalWorker({
      proxyUrl: sidecar.url,
      sleep: async () => {},
    });
    const probe = await worker.probe();
    expect(probe.ok).toBe(true);
    expect(probe.online).toBe(true);
    expect(probe.warning).toMatch(/sendReady:false/i);
    expect(sidecar.state.loginStatusHits).toBe(0);
  });

  it("sendText maps vNext three-state and ambiguous/failed", async () => {
    const sidecar = await startMockSidecar();
    closers.push(sidecar.close);
    const worker = createLocalHttpWechatPersonalWorker({
      proxyUrl: sidecar.url,
      sleep: async () => {},
    });

    sidecar.state.sendMode = "delivered";
    await expect(
      worker.sendText?.({ accountId: "default", to: "filehelper", text: "a" }),
    ).resolves.toEqual({ messageId: "msg-1", deliveryStatus: "delivered" });

    sidecar.state.sendMode = "submitted_unconfirmed";
    await expect(
      worker.sendText?.({ accountId: "default", to: "filehelper", text: "b" }),
    ).resolves.toEqual({ messageId: "msg-1", deliveryStatus: "submitted_unconfirmed" });

    sidecar.state.sendMode = "status_unknown";
    await expect(
      worker.sendText?.({ accountId: "default", to: "filehelper", text: "c" }),
    ).resolves.toEqual({ messageId: "msg-1", deliveryStatus: "status_unknown" });

    sidecar.state.sendMode = "failed_200";
    await expect(
      worker.sendText?.({ accountId: "default", to: "filehelper", text: "d" }),
    ).rejects.toThrow(/SEND_FAILED|native reject|failed/i);

    sidecar.state.sendMode = "ambiguous_409";
    try {
      await worker.sendText?.({ accountId: "default", to: "bob", text: "e" });
      expect.fail("expected ambiguous throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/Ambiguous WeChat recipient/i);
      expect((error as Error & { code?: string }).code).toBe("AMBIGUOUS_RECIPIENT");
      expect((error as Error & { candidates?: unknown }).candidates).toEqual([
        { id: "a" },
        { id: "b" },
      ]);
    }
  });
});
