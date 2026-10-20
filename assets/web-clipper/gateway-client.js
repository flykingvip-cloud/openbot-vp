const CONNECT_FAILED_CLOSE_CODE = 4008;
const CLIENT_ID = "openbot-web-clipper";
const CLIENT_MODE = "ui";

function randomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class OpenBotGatewayClient {
  constructor(options) {
    this.url = options.url;
    this.token = options.token?.trim() || "";
    this.ws = null;
    this.pending = new Map();
    this.connectNonce = null;
    this.connectSent = false;
    this.hello = null;
    this._connectPromise = null;
  }

  async connect() {
    if (this.hello) {
      return this.hello;
    }
    if (this._connectPromise) {
      return this._connectPromise;
    }
    this._connectPromise = new Promise((resolve, reject) => {
      this._resolveConnect = resolve;
      this._rejectConnect = reject;
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener("open", () => {
        this.queueConnect();
      });
      this.ws.addEventListener("message", (event) => this.handleMessage(String(event.data ?? "")));
      this.ws.addEventListener("close", (event) => {
        this.flushPending(new Error(`gateway closed (${event.code})`));
        if (!this.hello) {
          reject(new Error(`gateway closed (${event.code}): ${event.reason || "connect failed"}`));
        }
        this._connectPromise = null;
        this.hello = null;
      });
      this.ws.addEventListener("error", () => {
        if (!this.hello) {
          reject(new Error("gateway connection error"));
        }
      });
    });
    return this._connectPromise;
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.hello = null;
    this._connectPromise = null;
  }

  async request(method, params) {
    if (method !== "connect") {
      await this.connect();
    } else if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway socket not open");
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway not connected");
    }
    const id = randomId();
    const frame = { type: "req", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(frame));
    });
  }

  flushPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  queueConnect() {
    this.connectSent = false;
    globalThis.setTimeout(() => {
      void this.sendConnect();
    }, 300);
  }

  async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (!this.token) {
      this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "token missing");
      return;
    }
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: CLIENT_ID,
        displayName: "OpenBot Web Clipper",
        version: "0.1.0",
        platform: "chrome-extension",
        mode: CLIENT_MODE,
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      auth: { token: this.token },
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };
    try {
      const hello = await this.request("connect", params);
      this.hello = hello;
      this._resolveConnect?.(hello);
    } catch (error) {
      this._rejectConnect?.(error);
      this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
    }
  }

  handleMessage(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed?.type === "event") {
      if (parsed.event === "connect.challenge") {
        const nonce =
          parsed.payload && typeof parsed.payload.nonce === "string"
            ? parsed.payload.nonce
            : null;
        if (nonce) {
          this.connectNonce = nonce;
          this.connectSent = false;
          void this.sendConnect();
        }
      }
      return;
    }
    if (parsed?.type !== "res") {
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);
    if (parsed.ok) {
      pending.resolve(parsed.payload);
    } else {
      pending.reject(
        new Error(parsed.error?.message || parsed.error?.code || "request failed"),
      );
    }
  }
}

export async function collectWebClip(client, payload) {
  return client.request("knowledge.personal.collectWeb", payload);
}

export async function listKnowledgeBases(client) {
  const response = await client.request("knowledge.base.list", {});
  return Array.isArray(response?.knowledgeBases) ? response.knowledgeBases : [];
}
