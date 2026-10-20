import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { startBrowserBridgeServer, stopBrowserBridgeServer } from "../../browser/bridge-server.js";
import type { ResolvedBrowserConfig } from "../../browser/config.js";
import {
  DEFAULT_OPENCLAW_BROWSER_COLOR,
  DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME,
} from "../../browser/constants.js";
import { rfbVncAuthResponse } from "../../browser/novnc-rfb-des.js";
import {
  ACCOUNT_COMPUTER_PUBLIC_KEYS,
  endAccountComputer,
  publishAccountComputerObserver,
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
  setAccountComputerReleaseDepsForTests,
} from "./account-computer-stream.js";
import {
  consumeNoVncObserverToken,
  describeNoVncObserverToken,
  resetNoVncObserverTokensForTests,
} from "./novnc-auth.js";

const ACCOUNT = { tenantId: "tenant-1", userId: "user-1" };

function publish(overrides: Partial<Parameters<typeof publishAccountComputerObserver>[0]> = {}) {
  return publishAccountComputerObserver({
    ...ACCOUNT,
    noVncPort: 6080,
    password: "secret-vnc",
    bridgeBaseUrl: "http://127.0.0.1:18789",
    scopeKey: "scope-a",
    containerName: "openbot-sb-browser-a",
    agentLabel: "Ada",
    ...overrides,
  });
}

function buildResolvedConfig(): ResolvedBrowserConfig {
  return {
    enabled: true,
    evaluateEnabled: false,
    controlPort: 0,
    cdpPortRangeStart: 18800,
    cdpPortRangeEnd: 18899,
    cdpProtocol: "http",
    cdpHost: "127.0.0.1",
    cdpIsLoopback: true,
    remoteCdpTimeoutMs: 1500,
    remoteCdpHandshakeTimeoutMs: 3000,
    extraArgs: [],
    color: DEFAULT_OPENCLAW_BROWSER_COLOR,
    executablePath: undefined,
    headless: true,
    noSandbox: false,
    attachOnly: true,
    defaultProfile: DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME,
    profiles: {
      [DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME]: {
        cdpPort: 1,
        color: DEFAULT_OPENCLAW_BROWSER_COLOR,
      },
    },
  } as unknown as ResolvedBrowserConfig;
}

const KEY_EVENT = Buffer.from([0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61]);
const POINTER_EVENT = Buffer.from([0x05, 0x01, 0x00, 0x0a, 0x00, 0x14]);
const FRAMEBUFFER_REQUEST = Buffer.from([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function grantIdFrom(html: string): string {
  const match = html.match(/grant%3D([a-f0-9]+)/i);
  if (!match?.[1]) {
    throw new Error("relay grant missing from bootstrap");
  }
  return match[1];
}

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

class TestBytes {
  private chunks: Buffer[] = [];
  private waiter: ((chunk: Buffer) => void) | null = null;

  push(chunk: Buffer) {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(chunk);
      return;
    }
    this.chunks.push(chunk);
  }

  drain(): Buffer {
    if (this.chunks.length === 0) {
      return Buffer.alloc(0);
    }
    const all = Buffer.concat(this.chunks);
    this.chunks = [];
    return all;
  }

  async read(size: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let got = 0;
    while (got < size) {
      const next =
        this.chunks.length > 0
          ? this.chunks.shift()!
          : await new Promise<Buffer>((resolve) => {
              this.waiter = resolve;
            });
      parts.push(next);
      got += next.length;
    }
    const all = Buffer.concat(parts);
    if (all.length > size) {
      this.chunks.unshift(all.subarray(size));
      return all.subarray(0, size);
    }
    return all;
  }
}

function containsBytes(chunks: Buffer[], needle: Buffer): boolean {
  return Buffer.concat(chunks).indexOf(needle) !== -1;
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for relay bytes");
}

function startFakeNoVnc(password: string) {
  const received: Buffer[] = [];
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  wss.on("connection", (ws) => {
    const incoming = new TestBytes();
    let handshake = true;
    ws.on("message", (data) => {
      const chunk = asBuffer(data);
      if (handshake) {
        incoming.push(chunk);
        return;
      }
      received.push(chunk);
    });
    void (async () => {
      ws.send(Buffer.from("RFB 003.008\n"));
      await incoming.read(12);
      ws.send(Buffer.from([1, 2]));
      await incoming.read(1);
      const challenge = Buffer.alloc(16, 9);
      ws.send(challenge);
      const response = await incoming.read(16);
      if (!response.equals(rfbVncAuthResponse(challenge, password))) {
        ws.send(Buffer.from([0, 0, 0, 1]));
        ws.close();
        return;
      }
      ws.send(Buffer.from([0, 0, 0, 0]));
      await incoming.read(1);
      const extra = incoming.drain();
      handshake = false;
      if (extra.length > 0) {
        received.push(extra);
      }
      ws.send(Buffer.alloc(24));
    })().catch(() => ws.close());
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => Promise<void> }>(
    (resolve) => {
      wss.on("listening", () => {
        const address = wss.address() as AddressInfo;
        resolve({
          port: address.port,
          received,
          close: () =>
            new Promise((done) => {
              wss.close(() => done());
            }),
        });
      });
    },
  );
}

async function openRelaySocket(bridgeBaseUrl: string, grantId: string) {
  const ws = new WebSocket(
    `${bridgeBaseUrl.replace(/^http/, "ws")}/sandbox/novnc/ws?grant=${grantId}`,
  );
  const incoming = new TestBytes();
  ws.on("message", (data) => incoming.push(asBuffer(data)));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const version = await incoming.read(12);
  if (version.toString() !== "RFB 003.008\n") {
    throw new Error(`unexpected version ${version.toString()}`);
  }
  ws.send(Buffer.from("RFB 003.008\n"));
  const security = await incoming.read(2);
  if (security[0] !== 1 || security[1] !== 1) {
    throw new Error("relay did not offer security type None");
  }
  ws.send(Buffer.from([1]));
  const result = await incoming.read(4);
  if (result.readUInt32BE(0) !== 0) {
    throw new Error("relay rejected the client");
  }
  ws.send(Buffer.from([1]));
  await incoming.read(24);
  return ws;
}

function hosted(baseUrl: string, streamUrl: string | undefined): string {
  const value = String(streamUrl ?? "");
  return value.startsWith("/") ? `${baseUrl}${value}` : value;
}

function tokenFrom(streamUrl: string | undefined): string {
  const token = new URL(
    streamUrl ?? "http://127.0.0.1/missing",
    "http://127.0.0.1",
  ).searchParams.get("token");
  if (!token) {
    throw new Error("missing observer token");
  }
  return token;
}

describe("account computer stream", () => {
  const servers: Array<{ stop: () => Promise<void> }> = [];

  beforeEach(() => {
    resetAccountComputerSlotsForTests();
    resetNoVncObserverTokensForTests();
  });

  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop();
      if (server) {
        await server.stop();
      }
    }
  });

  async function startBridge() {
    const bridge = await startBrowserBridgeServer({
      resolved: buildResolvedConfig(),
      authToken: "secret-token",
      resolveSandboxNoVncToken: consumeNoVncObserverToken,
    });
    servers.push({ stop: () => stopBrowserBridgeServer(bridge.server) });
    return bridge;
  }

  it("mints a fresh token per open against one noVNC port", async () => {
    const bridge = await startBridge();
    expect(
      publish({ bridgeBaseUrl: bridge.baseUrl, noVncPort: 16080, password: "secret-vnc" }).reused,
    ).toBe(false);
    const first = readAccountComputerPreview({ ...ACCOUNT, issueUrl: true, sessionKey: "chat-a" });
    expect(publish({ agentLabel: "Bea", noVncPort: 16999, containerName: "other" }).reused).toBe(
      true,
    );
    const second = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
    });
    expect(second.streamUrl).toMatch(/^\/sandbox\/novnc\?token=/);
    expect(second.streamUrl).not.toContain("127.0.0.1");
    expect(second.streamUrl).not.toBe(first.streamUrl);
    expect(second.streamUrl).not.toContain("secret-vnc");
    expect(second.streamUrl).not.toContain("password=");
    expect(second.controlledBy).toEqual({ kind: "agent", label: "Bea" });
    expect(Object.keys(second).toSorted()).toEqual([...ACCOUNT_COMPUTER_PUBLIC_KEYS].toSorted());
    expect(describeNoVncObserverToken(tokenFrom(first.streamUrl))).toMatchObject({
      tenantId: ACCOUNT.tenantId,
      userId: ACCOUNT.userId,
      noVncPort: 16080,
      viewOnly: true,
    });
    expect(describeNoVncObserverToken(tokenFrom(second.streamUrl))).toMatchObject({
      tenantId: ACCOUNT.tenantId,
      userId: ACCOUNT.userId,
      noVncPort: 16080,
      viewOnly: true,
    });

    const resA = await fetch(hosted(bridge.baseUrl, first.streamUrl));
    const resB = await fetch(hosted(bridge.baseUrl, second.streamUrl));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = await resA.text();
    const bodyB = await resB.text();
    expect(bodyA).toContain("/sandbox/novnc/static/");
    expect(bodyA).toContain("/core/rfb.js");
    expect(bodyA).toContain("scaleViewport = true");
    expect(bodyA).toContain("resizeSession = false");
    expect(bodyA).not.toContain("/vnc.html");
    expect(bodyA).not.toContain("noVNC_control_bar");
    expect(bodyB).toContain("/sandbox/novnc/static/");
    expect(bodyA).not.toContain("127.0.0.1");
    expect(bodyB).not.toContain("127.0.0.1");
    expect(bodyA).not.toContain("16080");
    expect(bodyB).not.toContain("16080");
    expect(bodyA).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3D");
    expect(bodyB).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3D");
    expect(bodyA).not.toContain("secret-vnc");
    expect(bodyB).not.toContain("secret-vnc");
    expect(bodyA).not.toContain("password=");
    expect(bodyB).not.toContain("password=");
    expect(bodyA).not.toContain("16999");
    expect(bodyB).not.toContain("16999");
  });

  it("does not let another user's token open this computer, and rejects an expired token", async () => {
    const bridge = await startBridge();
    publish({ bridgeBaseUrl: bridge.baseUrl, noVncPort: 16080 });
    publish({
      tenantId: "tenant-1",
      userId: "user-2",
      noVncPort: 17081,
      bridgeBaseUrl: bridge.baseUrl,
      scopeKey: "scope-b",
      containerName: "openbot-sb-browser-b",
    });
    const owner = readAccountComputerPreview({ ...ACCOUNT, issueUrl: true, sessionKey: "chat-a" });
    const other = readAccountComputerPreview({
      tenantId: "tenant-1",
      userId: "user-2",
      issueUrl: true,
      sessionKey: "chat-b",
    });
    expect(describeNoVncObserverToken(tokenFrom(other.streamUrl))?.noVncPort).toBe(17081);
    expect(describeNoVncObserverToken(tokenFrom(other.streamUrl))?.userId).toBe("user-2");
    const otherRes = await fetch(hosted(bridge.baseUrl, other.streamUrl));
    expect(otherRes.status).toBe(200);
    const otherBody = await otherRes.text();
    expect(otherBody).toContain("/sandbox/novnc/static/");
    expect(otherBody).not.toContain("17081");
    expect(otherBody).not.toContain("16080");
    expect(otherBody).not.toContain("127.0.0.1");

    const expired = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
      nowMs: 1,
    });
    const expiredRes = await fetch(hosted(bridge.baseUrl, expired.streamUrl));
    expect(expiredRes.status).toBe(404);
    expect(await expiredRes.text()).not.toContain("vnc.html");
    expect(owner.streamUrl).not.toBe(expired.streamUrl);
  });

  it("issues view-only tokens for other sessions and an input token for the controller", async () => {
    const bridge = await startBridge();
    publish({ bridgeBaseUrl: bridge.baseUrl, noVncPort: 16080, password: "secret-vnc" });
    const watcher = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
    });
    const controller = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
      takeControl: true,
      operatorLabel: "ada@example.com",
    });
    const watcherAgain = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
    });
    expect(describeNoVncObserverToken(tokenFrom(watcher.streamUrl))?.viewOnly).toBe(true);
    expect(describeNoVncObserverToken(tokenFrom(controller.streamUrl))?.viewOnly).toBe(false);
    expect(describeNoVncObserverToken(tokenFrom(watcherAgain.streamUrl))?.viewOnly).toBe(true);

    const watchRes = await fetch(hosted(bridge.baseUrl, watcher.streamUrl));
    const controlRes = await fetch(hosted(bridge.baseUrl, controller.streamUrl));
    const watchAgainRes = await fetch(hosted(bridge.baseUrl, watcherAgain.streamUrl));
    expect(watchRes.status).toBe(200);
    expect(controlRes.status).toBe(200);
    expect(watchAgainRes.status).toBe(200);
    const watchBody = await watchRes.text();
    const controlBody = await controlRes.text();
    const watchAgainBody = await watchAgainRes.text();
    expect(watchBody).not.toContain("secret-vnc");
    expect(watchAgainBody).not.toContain("secret-vnc");
    expect(controlBody).not.toContain("secret-vnc");
    expect(watchBody).not.toContain("password=");
    expect(controlBody).not.toContain("password=");
    expect(watchBody).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3D");
    expect(controlBody).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3D");
    expect(watchBody).toContain("/sandbox/novnc/static/");
    expect(controlBody).toContain("/sandbox/novnc/static/");
    expect(watchBody).not.toContain("127.0.0.1");
    expect(controlBody).not.toContain("16080");
    expect(controller.controlledBy).toEqual({ kind: "user", label: "user-1" });
    expect(watcherAgain.controlledBy).toEqual({ kind: "user", label: "user-1" });

    const staleControl = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
      takeControl: true,
    });
    const handed = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
      takeControl: true,
    });
    const staleRes = await fetch(hosted(bridge.baseUrl, staleControl.streamUrl));
    expect(staleRes.status).toBe(404);
    const handedRes = await fetch(hosted(bridge.baseUrl, handed.streamUrl));
    expect(handedRes.status).toBe(200);
    const handedBody = await handedRes.text();
    expect(handedBody).not.toContain("secret-vnc");
    expect(handedBody).not.toContain("password=");
    expect(handedBody).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3D");
    expect(handed.controlledBy).toEqual({ kind: "user", label: "user-1" });
    const released = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: false,
      sessionKey: "chat-a",
      releaseControl: true,
    });
    expect(released.controlledBy).toEqual({ kind: "agent", label: "Ada" });
  });

  it("drops viewer input on the relay and cuts the previous controller after handoff", async () => {
    const password = "secret-vnc";
    const fake = await startFakeNoVnc(password);
    servers.push({ stop: fake.close });
    const bridge = await startBridge();
    publish({
      bridgeBaseUrl: bridge.baseUrl,
      noVncPort: fake.port,
      password,
    });
    const viewer = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
    });
    const viewerPage = await fetch(hosted(bridge.baseUrl, viewer.streamUrl));
    const viewerHtml = await viewerPage.text();
    expect(viewerHtml).not.toContain(password);
    expect(viewerHtml).not.toContain("password=");
    const viewerSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(viewerHtml));
    viewerSocket.send(Buffer.concat([KEY_EVENT, POINTER_EVENT, FRAMEBUFFER_REQUEST]));
    await waitFor(() => containsBytes(fake.received, FRAMEBUFFER_REQUEST));
    const afterViewer = Buffer.concat(fake.received);
    expect(afterViewer.indexOf(KEY_EVENT)).toBe(-1);
    expect(afterViewer.indexOf(POINTER_EVENT)).toBe(-1);
    expect(afterViewer.indexOf(FRAMEBUFFER_REQUEST)).toBeGreaterThanOrEqual(0);

    const controller = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
      takeControl: true,
    });
    const controllerPage = await fetch(hosted(bridge.baseUrl, controller.streamUrl));
    const controllerHtml = await controllerPage.text();
    expect(controllerHtml).not.toContain(password);
    expect(controllerHtml).not.toContain("password=");
    const controllerSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(controllerHtml));
    controllerSocket.send(KEY_EVENT);
    await waitFor(() => containsBytes(fake.received, KEY_EVENT));

    const handed = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
      takeControl: true,
    });
    const marked = Buffer.concat(fake.received).length;
    controllerSocket.send(Buffer.concat([KEY_EVENT, POINTER_EVENT, FRAMEBUFFER_REQUEST]));
    await waitFor(() => Buffer.concat(fake.received).length > marked);
    const afterHandoff = Buffer.concat(fake.received).subarray(marked);
    expect(afterHandoff.indexOf(KEY_EVENT)).toBe(-1);
    expect(afterHandoff.indexOf(POINTER_EVENT)).toBe(-1);
    expect(afterHandoff.indexOf(FRAMEBUFFER_REQUEST)).toBeGreaterThanOrEqual(0);

    const handedPage = await fetch(hosted(bridge.baseUrl, handed.streamUrl));
    const handedHtml = await handedPage.text();
    expect(handedHtml).not.toContain(password);
    const nextSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(handedHtml));
    const cursor = marked + afterHandoff.length;
    nextSocket.send(KEY_EVENT);
    await waitFor(() => Buffer.concat(fake.received).length > cursor);
    expect(Buffer.concat(fake.received).subarray(cursor).indexOf(KEY_EVENT)).toBeGreaterThanOrEqual(
      0,
    );
    viewerSocket.close();
    controllerSocket.close();
    nextSocket.close();
  });

  it("serves noVNC from the bridge origin and hides the container port", async () => {
    const files = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
      const server = http.createServer((req, res) => {
        if (req.url === "/vnc.html") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end("<!doctype html><title>novnc-static</title>");
          return;
        }
        res.statusCode = 404;
        res.end("missing");
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        resolve({
          port: address.port,
          close: () =>
            new Promise((done) => {
              server.close(() => done());
            }),
        });
      });
    });
    servers.push({ stop: files.close });
    const bridge = await startBridge();
    publish({
      bridgeBaseUrl: bridge.baseUrl,
      noVncPort: files.port,
      password: "secret-vnc",
    });
    const opened = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
    });
    const html = await (await fetch(hosted(bridge.baseUrl, opened.streamUrl))).text();
    expect(html).toContain("/sandbox/novnc/static/");
    expect(html).not.toContain(String(files.port));
    expect(html).not.toContain("secret-vnc");
    expect(html).not.toContain("password=");
    expect(html).not.toContain("127.0.0.1");
    const grant = grantIdFrom(html);
    const asset = await fetch(`${bridge.baseUrl}/sandbox/novnc/static/${grant}/vnc.html`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("novnc-static");
    const bridgeUrl = new URL(bridge.baseUrl);
    const escaped = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: bridgeUrl.hostname,
          port: bridgeUrl.port,
          path: `/sandbox/novnc/static/${grant}/../vnc.html`,
          method: "GET",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(escaped).not.toBe(200);
    const directSocket = await fetch(`${bridge.baseUrl}/sandbox/novnc/static/${grant}/websockify`);
    expect(directSocket.status).toBe(404);
  });

  it("drops split frames, closes unknown RFB types, and rejects a reused grant", async () => {
    const password = "secret-vnc";
    const fake = await startFakeNoVnc(password);
    servers.push({ stop: fake.close });
    const bridge = await startBridge();
    publish({ bridgeBaseUrl: bridge.baseUrl, noVncPort: fake.port, password });
    const viewer = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-a",
    });
    const viewerHtml = await (await fetch(hosted(bridge.baseUrl, viewer.streamUrl))).text();
    const viewerSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(viewerHtml));
    viewerSocket.send(KEY_EVENT.subarray(0, 3));
    viewerSocket.send(
      Buffer.concat([
        KEY_EVENT.subarray(3),
        POINTER_EVENT.subarray(0, 2),
        POINTER_EVENT.subarray(2),
        FRAMEBUFFER_REQUEST,
      ]),
    );
    await waitFor(() => containsBytes(fake.received, FRAMEBUFFER_REQUEST));
    const viewed = Buffer.concat(fake.received);
    expect(viewed.indexOf(KEY_EVENT)).toBe(-1);
    expect(viewed.indexOf(POINTER_EVENT)).toBe(-1);

    const controller = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
      takeControl: true,
      operatorLabel: "user-1",
    });
    expect(controller.controlledBy).toEqual({ kind: "user", label: "user-1" });
    const controllerHtml = await (await fetch(hosted(bridge.baseUrl, controller.streamUrl))).text();
    const controllerSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(controllerHtml));
    controllerSocket.send(KEY_EVENT);
    await waitFor(() => containsBytes(fake.received, KEY_EVENT));

    const repeated = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
      takeControl: true,
    });
    const marked = Buffer.concat(fake.received).length;
    controllerSocket.send(Buffer.concat([KEY_EVENT, POINTER_EVENT, FRAMEBUFFER_REQUEST]));
    await waitFor(() => Buffer.concat(fake.received).length > marked);
    const afterRepeat = Buffer.concat(fake.received).subarray(marked);
    expect(afterRepeat.indexOf(KEY_EVENT)).toBe(-1);
    expect(afterRepeat.indexOf(POINTER_EVENT)).toBe(-1);
    expect(afterRepeat.indexOf(FRAMEBUFFER_REQUEST)).toBeGreaterThanOrEqual(0);

    const repeatedHtml = await (await fetch(hosted(bridge.baseUrl, repeated.streamUrl))).text();
    const repeatedSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(repeatedHtml));
    const cursor = marked + afterRepeat.length;
    repeatedSocket.send(KEY_EVENT);
    await waitFor(() => Buffer.concat(fake.received).length > cursor);
    expect(Buffer.concat(fake.received).subarray(cursor).indexOf(KEY_EVENT)).toBeGreaterThanOrEqual(
      0,
    );

    const reusedUrl = `${bridge.baseUrl.replace(/^http/, "ws")}/sandbox/novnc/ws?grant=${grantIdFrom(repeatedHtml)}`;
    repeatedSocket.close();
    await new Promise((resolve) => repeatedSocket.once("close", resolve));
    const retry = new WebSocket(reusedUrl);
    const outcome = await new Promise<string>((resolve) => {
      retry.once("open", () => resolve("open"));
      retry.once("unexpected-response", () => resolve("rejected"));
      retry.once("error", () => resolve("error"));
    });
    expect(outcome).not.toBe("open");
    retry.close();

    const unknown = readAccountComputerPreview({
      ...ACCOUNT,
      issueUrl: true,
      sessionKey: "chat-b",
      takeControl: true,
    });
    const unknownHtml = await (await fetch(hosted(bridge.baseUrl, unknown.streamUrl))).text();
    const unknownSocket = await openRelaySocket(bridge.baseUrl, grantIdFrom(unknownHtml));
    const closed = new Promise((resolve) => unknownSocket.once("close", resolve));
    unknownSocket.send(Buffer.from([0x99]));
    await closed;

    viewerSocket.close();
    controllerSocket.close();
  });

  it("does not expose another user's stream", () => {
    publish();
    readAccountComputerPreview({ ...ACCOUNT, issueUrl: true });
    const other = readAccountComputerPreview({
      tenantId: "tenant-1",
      userId: "user-2",
      issueUrl: true,
    });
    expect(other.status).toBe("COLD");
    expect(other.streamUrl).toBeUndefined();
  });

  it("ends the browser process and leaves the profile directory alone", async () => {
    const rm = vi.spyOn(fs, "rm").mockImplementation(() => undefined as never);
    const stopBridge = vi.fn(async () => undefined);
    const stopContainer = vi.fn(async () => undefined);
    setAccountComputerReleaseDepsForTests({ stopBridge, stopContainer });
    publish();
    const ended = await endAccountComputer(ACCOUNT);
    expect(ended.status).toBe("DISCONNECTED");
    expect(ended.streamUrl).toBeUndefined();
    expect(stopBridge).toHaveBeenCalledWith("scope-a");
    expect(stopContainer).toHaveBeenCalledWith("openbot-sb-browser-a");
    expect(rm).not.toHaveBeenCalled();
    expect(readAccountComputerPreview({ ...ACCOUNT, issueUrl: true }).status).toBe("DISCONNECTED");
    rm.mockRestore();
  });
});
