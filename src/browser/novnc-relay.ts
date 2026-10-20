/**
 * Account-computer noVNC relay.
 *
 * The browser never receives the VNC password. It speaks RFB to this process
 * with security type None. The relay authenticates upstream with the slot
 * password and forwards bytes. Key, pointer, and clipboard messages are
 * forwarded only while the grant's `input` flag is set. Handoff clears that
 * flag on the previous controller's already-open socket.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import {
  claimNoVncRelayGrant,
  type NoVncRelayGrant,
  releaseNoVncRelayGrant,
} from "../agents/sandbox/novnc-auth.js";
import { rfbVncAuthResponse } from "./novnc-rfb-des.js";

const INPUT_MESSAGE_TYPES = new Set([4, 5, 6, 255]);
const MAX_RFB_PAYLOAD = 1_000_000;

export type RfbClientTake =
  | { kind: "need-more" }
  | { kind: "invalid" }
  | { kind: "message"; message: Buffer; rest: Buffer; input: boolean };

export function takeRfbClientMessage(buffer: Buffer): RfbClientTake {
  if (buffer.length < 1) {
    return { kind: "need-more" };
  }
  const type = buffer[0];
  let length = 0;
  switch (type) {
    case 0:
      length = 20;
      break;
    case 2: {
      if (buffer.length < 4) {
        return { kind: "need-more" };
      }
      const count = buffer.readUInt16BE(2);
      if (count > 4096) {
        return { kind: "invalid" };
      }
      length = 4 + count * 4;
      break;
    }
    case 3:
      length = 10;
      break;
    case 4:
      length = 8;
      break;
    case 5:
      length = 6;
      break;
    case 6: {
      if (buffer.length < 8) {
        return { kind: "need-more" };
      }
      const raw = buffer.readInt32BE(4);
      const count = raw < 0 ? -raw : raw;
      if (count > MAX_RFB_PAYLOAD) {
        return { kind: "invalid" };
      }
      length = 8 + count;
      break;
    }
    case 150:
      length = 10;
      break;
    case 248: {
      if (buffer.length < 9) {
        return { kind: "need-more" };
      }
      const count = buffer[8];
      length = 9 + count;
      break;
    }
    case 251: {
      if (buffer.length < 8) {
        return { kind: "need-more" };
      }
      const screens = buffer[6];
      length = 8 + screens * 16;
      break;
    }
    case 255:
      length = 12;
      break;
    default:
      return { kind: "invalid" };
  }
  if (buffer.length < length) {
    return { kind: "need-more" };
  }
  return {
    kind: "message",
    message: buffer.subarray(0, length),
    rest: buffer.subarray(length),
    input: INPUT_MESSAGE_TYPES.has(type),
  };
}

export function drainRfbClientPending(
  pending: Buffer,
  allowInput: boolean,
): { pending: Buffer; forward: Buffer; invalid: boolean } {
  const parts: Buffer[] = [];
  let rest = pending;
  while (rest.length > 0) {
    const taken = takeRfbClientMessage(rest);
    if (taken.kind === "need-more") {
      return { pending: rest, forward: Buffer.concat(parts), invalid: false };
    }
    if (taken.kind === "invalid") {
      return { pending: rest, forward: Buffer.concat(parts), invalid: true };
    }
    rest = taken.rest;
    if (!taken.input || allowInput) {
      parts.push(taken.message);
    }
  }
  return { pending: Buffer.alloc(0), forward: Buffer.concat(parts), invalid: false };
}

export function forwardRfbClientBytes(buffer: Buffer, allowInput: boolean): Buffer {
  return drainRfbClientPending(buffer, allowInput).forward;
}

class ByteStream {
  private chunks: Buffer[] = [];
  private waiter: ((chunk: Buffer) => void) | null = null;
  private fail: ((error: Error) => void) | null = null;
  private closed = false;

  push(chunk: Buffer) {
    if (this.closed || chunk.length === 0) {
      return;
    }
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      this.fail = null;
      resolve(chunk);
      return;
    }
    this.chunks.push(chunk);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.fail?.(new Error("novnc relay closed"));
    this.waiter = null;
    this.fail = null;
  }

  read(size: number): Promise<Buffer> {
    return this.collect(size);
  }

  readAvailable(): Promise<Buffer> {
    if (this.chunks.length > 0) {
      const all = Buffer.concat(this.chunks);
      this.chunks = [];
      return Promise.resolve(all);
    }
    if (this.closed) {
      return Promise.reject(new Error("novnc relay closed"));
    }
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("novnc relay closed"));
        return;
      }
      this.waiter = resolve;
      this.fail = reject;
    });
  }

  private async collect(size: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let got = 0;
    while (got < size) {
      const next = await this.readAvailable();
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

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function send(socket: WebSocket, payload: Buffer) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  }
}

async function authenticateUpstream(
  upstream: WebSocket,
  incoming: ByteStream,
  password: string | undefined,
) {
  const countBuf = await incoming.read(1);
  const count = countBuf[0];
  if (!count) {
    throw new Error("upstream refused security types");
  }
  const types = new Set(await incoming.read(count));
  const chosen = password && types.has(2) ? 2 : types.has(1) ? 1 : null;
  if (chosen == null) {
    throw new Error("upstream security type is not usable");
  }
  send(upstream, Buffer.from([chosen]));
  if (chosen === 2) {
    const challenge = await incoming.read(16);
    send(upstream, rfbVncAuthResponse(challenge, password ?? ""));
  }
  const result = await incoming.read(4);
  if (result.readUInt32BE(0) !== 0) {
    throw new Error("upstream rejected the relay auth");
  }
}

async function proxyNoVncRelay(client: WebSocket, grant: NoVncRelayGrant) {
  const upstream = new WebSocket(`ws://127.0.0.1:${grant.noVncPort}/websockify`);
  const clientIn = new ByteStream();
  const upstreamIn = new ByteStream();
  const stop = () => {
    clientIn.close();
    upstreamIn.close();
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };
  client.on("message", (data) => clientIn.push(asBuffer(data)));
  client.on("close", stop);
  client.on("error", stop);
  upstream.on("message", (data) => upstreamIn.push(asBuffer(data)));
  upstream.on("close", stop);
  upstream.on("error", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      upstream.once("open", () => resolve());
      upstream.once("error", reject);
    });
    const version = await upstreamIn.read(12);
    send(client, version);
    send(upstream, await clientIn.read(12));
    await authenticateUpstream(upstream, upstreamIn, grant.password);
    send(client, Buffer.from([1, 1]));
    const selected = await clientIn.read(1);
    if (selected[0] !== 1) {
      throw new Error("client did not accept security type None");
    }
    send(client, Buffer.from([0, 0, 0, 0]));
    send(upstream, await clientIn.read(1));
    await Promise.all([
      (async () => {
        while (client.readyState === WebSocket.OPEN) {
          const chunk = await upstreamIn.readAvailable();
          send(client, chunk);
        }
      })(),
      (async () => {
        let pending: Buffer = Buffer.alloc(0);
        while (upstream.readyState === WebSocket.OPEN) {
          pending = Buffer.concat([pending, await clientIn.readAvailable()]);
          const drained = drainRfbClientPending(pending, grant.input);
          pending = drained.pending;
          if (drained.invalid) {
            throw new Error("unrecognized RFB client message");
          }
          if (drained.forward.length > 0) {
            send(upstream, drained.forward);
          }
        }
      })(),
    ]);
  } catch {
    stop();
  }
}

const RELAY_SOCKETS = new WebSocketServer({ noServer: true });

/**
 * One websocket per grant. Returns true when this upgrade belongs to the
 * account-computer relay, including a rejected reconnect. Other paths return
 * false so a shared HTTP server can keep its own upgrade handler.
 */
export function handleNoVncObserverUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    return false;
  }
  if (url.pathname !== "/sandbox/novnc/ws") {
    return false;
  }
  const grantId = url.searchParams.get("grant")?.trim() ?? "";
  const grant = claimNoVncRelayGrant(grantId);
  if (!grant) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return true;
  }
  RELAY_SOCKETS.handleUpgrade(req, socket, head, (ws) => {
    const release = () => releaseNoVncRelayGrant(grant);
    ws.on("close", release);
    ws.on("error", release);
    void proxyNoVncRelay(ws, grant);
  });
  return true;
}

export function attachNoVncRelay(server: Server) {
  server.on("upgrade", (req, socket, head) => {
    if (!handleNoVncObserverUpgrade(req, socket, head)) {
      socket.destroy();
    }
  });
}
