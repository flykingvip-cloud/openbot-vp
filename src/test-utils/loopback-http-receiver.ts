/**
 * Loopback HTTP receiver for labeled network-mock evidence (P2-G/H).
 *
 * Prefers a real 127.0.0.1 listen. On EPERM/EACCES/EADDRNOTAVAIL (Codex sandbox
 * etc.) or OPENBOT_LOOPBACK_HTTP_FORCE_MOCK=1, falls back to undici MockAgent so
 * the suite never hangs on a listen promise without error handling, and never
 * silently claims pass when bind is forbidden. EADDRINUSE / listen timeout are
 * hard failures (not skip).
 *
 * Real TCP/Live listen evidence is separate: use tryProveRealLoopbackHttp() or
 * scripts/evidence/prove-loopback-http.ts. MockAgent proves fetch/dispatcher
 * only — never unify MockAgent with mode=listen as "HTTP PASS".
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

/** Structured real-listen evidence (never pretends MockAgent is TCP/Live). */
export type RealLoopbackHttpEvidence =
  | {
      ok: true;
      mode: "listen";
      port: number;
      roundTrip: { status: number; body: string };
    }
  | {
      ok: false;
      code: string;
      /** Only permission/sandbox limits may skip; EADDRINUSE / timeout / other → false. */
      skipped: boolean;
      reason: string;
    };

/**
 * Permission-style listen limits eligible for honest skip (not PASS).
 * EPERM/EACCES: sandbox/privilege. EADDRNOTAVAIL: sandbox/no usable bind addr.
 * Do NOT include EADDRINUSE or listen timeout — those are hard failures.
 */
const LISTEN_FORBIDDEN = new Set(["EPERM", "EACCES", "EADDRNOTAVAIL"]);

export function isListenForbiddenError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && LISTEN_FORBIDDEN.has(code);
}

export function isLoopbackListenRequired(): boolean {
  return process.env.OPENBOT_LOOPBACK_HTTP_REQUIRE_LISTEN === "1";
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
 * MockAgent fallback is NOT real TCP / Live evidence.
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

/**
 * Independently verifiable real loopback TCP HTTP evidence.
 * Never falls back to MockAgent. On permission/sandbox bind limits, returns
 * skipped:true (not PASS). EADDRINUSE, listen timeout, and other errors return
 * skipped:false (hard fail). When requireListen / OPENBOT_LOOPBACK_HTTP_REQUIRE_LISTEN=1,
 * throws instead of returning ok:false.
 */
export async function tryProveRealLoopbackHttp(options?: {
  listenTimeoutMs?: number;
  requireListen?: boolean;
  /** Test-only: replace listenOnLoopback (inject EADDRINUSE / timeout / EPERM). */
  listen?: (server: http.Server, host?: string, timeoutMs?: number) => Promise<AddressInfo>;
}): Promise<RealLoopbackHttpEvidence> {
  const requireListen = options?.requireListen === true || isLoopbackListenRequired();
  const listen = options?.listen ?? listenOnLoopback;
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, labeled: "real-loopback-http-listen-evidence" }));
  });

  let addr: AddressInfo;
  try {
    addr = await listen(server, "127.0.0.1", options?.listenTimeoutMs ?? 2_000);
  } catch (err) {
    await closeServerQuietly(server);
    const code =
      (err as NodeJS.ErrnoException | undefined)?.code ??
      (err instanceof Error && /timed out/.test(err.message) ? "ETIMEDOUT" : "LISTEN_FAILED");
    const permissionSkip = isListenForbiddenError(err);
    const reason = permissionSkip
      ? `mode=listen unavailable (${code}): Codex/restricted sandbox cannot bind 127.0.0.1; not counted as PASS. Run on USER/unrestricted or set OPENBOT_LOOPBACK_HTTP_REQUIRE_LISTEN=1 there.`
      : `mode=listen failed (${code}): ${err instanceof Error ? err.message : String(err)}`;
    if (requireListen) {
      throw new Error(
        `OPENBOT_LOOPBACK_HTTP_REQUIRE_LISTEN: real loopback listen required but unavailable (${code}). ${reason}`,
        { cause: err },
      );
    }
    return {
      ok: false,
      code: String(code),
      skipped: permissionSkip,
      reason,
    };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/prove-real-loopback`, {
      method: "GET",
    });
    const body = await res.text();
    return {
      ok: true,
      mode: "listen",
      port: addr.port,
      roundTrip: { status: res.status, body },
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
    });
  }
}
