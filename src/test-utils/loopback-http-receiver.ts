/**
 * Loopback HTTP receiver for labeled network-mock evidence (P2-G/H).
 *
 * Prefers a real 127.0.0.1 listen. On EPERM/EACCES (Codex sandbox etc.) or
 * OPENBOT_LOOPBACK_HTTP_FORCE_MOCK=1, falls back to undici MockAgent so the
 * suite never hangs on a listen promise without error handling, and never
 * silently claims pass when bind is forbidden.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";

export type LoopbackReceived = {
  method?: string;
  url?: string;
  body: string;
};

export type LoopbackHttpReceiver = {
  /** Real TCP listen vs undici MockAgent (no privileged bind). */
  mode: "listen" | "mock-agent";
  baseUrl: string;
  received: LoopbackReceived[];
  close: () => Promise<void>;
};

const LISTEN_FORBIDDEN = new Set(["EPERM", "EACCES", "EADDRNOTAVAIL"]);

export function isListenForbiddenError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && LISTEN_FORBIDDEN.has(code);
}

/**
 * Listen with once('error') + timeout. Never leaves a hanging Promise when
 * the sandbox rejects bind (the old listen(cb) pattern never fired).
 */
export async function listenOnLoopback(
  server: http.Server,
  host = "127.0.0.1",
  timeoutMs = 2_000,
): Promise<AddressInfo> {
  return await new Promise<AddressInfo>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.off("error", onError);
      server.off("listening", onListening);
      fn();
    };
    const onError = (err: Error) => {
      finish(() => reject(err));
      try {
        server.close();
      } catch {
        /* ignore */
      }
    };
    const onListening = () => {
      finish(() => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("loopback listen: missing AddressInfo"));
          return;
        }
        resolve(addr);
      });
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`loopback listen timed out after ${timeoutMs}ms`)));
      try {
        server.close();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, host);
  });
}

async function closeServerQuietly(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
    // close may never call back if never listening
    setTimeout(resolve, 50);
  });
}

function startMockAgentReceiver(params: {
  received: LoopbackReceived[];
  responseJson: unknown;
}): LoopbackHttpReceiver {
  const previous: Dispatcher = getGlobalDispatcher();
  const agent = new MockAgent({ connections: 1 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  // Non-privileged well-known-style port; undici rejects reserved "bad port" 9.
  const baseUrl = "http://127.0.0.1:34567";
  agent
    .get(baseUrl)
    .intercept({ path: /\/.*/, method: "POST" })
    .reply((opts) => {
      let body = "";
      if (typeof opts.body === "string") {
        body = opts.body;
      } else if (opts.body != null) {
        body = Buffer.from(opts.body as Uint8Array).toString("utf8");
      }
      params.received.push({
        method: opts.method,
        url: opts.path,
        body,
      });
      return {
        statusCode: 200,
        data: JSON.stringify(params.responseJson),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    })
    .persist();

  return {
    mode: "mock-agent",
    baseUrl,
    received: params.received,
    close: async () => {
      try {
        await agent.close();
      } finally {
        setGlobalDispatcher(previous);
      }
    },
  };
}

/**
 * Start a labeled loopback receiver. Prefer real listen; fall back to MockAgent
 * when bind is forbidden so dispatch→HTTP evidence can still be asserted.
 */
export async function startLoopbackHttpReceiver(options?: {
  listenTimeoutMs?: number;
  forceMockAgent?: boolean;
  responseJson?: unknown;
}): Promise<LoopbackHttpReceiver> {
  const received: LoopbackReceived[] = [];
  const responseJson = options?.responseJson ?? {
    ok: true,
    labeled: "loopback-http-mock",
  };
  const force =
    options?.forceMockAgent === true || process.env.OPENBOT_LOOPBACK_HTTP_FORCE_MOCK === "1";

  if (force) {
    return startMockAgentReceiver({ received, responseJson });
  }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      received.push({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(responseJson));
    });
  });

  try {
    const addr = await listenOnLoopback(server, "127.0.0.1", options?.listenTimeoutMs ?? 2_000);
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    return {
      mode: "listen",
      baseUrl,
      received,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      },
    };
  } catch (err) {
    await closeServerQuietly(server);
    if (!isListenForbiddenError(err)) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      throw new Error(
        `loopback HTTP listen failed (code=${code ?? "unknown"}): ${
          err instanceof Error ? err.message : String(err)
        }. Not a silent pass.`,
        { cause: err },
      );
    }
    // EPERM/EACCES: prove dispatch→HTTP via MockAgent without privileged listen.
    return startMockAgentReceiver({ received, responseJson });
  }
}
