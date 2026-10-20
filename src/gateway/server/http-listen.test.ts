import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayLockError } from "../../infra/gateway-lock.js";
import { listenGatewayHttpServer } from "./http-listen.js";

const sleepMock = vi.hoisted(() => vi.fn(async (_ms: number) => {}));
const describePortOwnerMock = vi.hoisted(() =>
  vi.fn(async (_port: number) => undefined as unknown),
);

vi.mock("../../utils.js", () => ({
  sleep: (ms: number) => sleepMock(ms),
}));

vi.mock("../../infra/ports.js", () => ({
  describePortOwner: (port: number) => describePortOwnerMock(port),
}));

type ListenOutcome = { kind: "error"; code: string } | { kind: "listening" };

function createFakeHttpServer(outcomes: ListenOutcome[]) {
  class FakeHttpServer extends EventEmitter {
    public closeCalls = 0;
    private attempt = 0;

    listen(_port: number, _host: string) {
      const outcome = outcomes[this.attempt] ?? { kind: "listening" };
      this.attempt += 1;
      setImmediate(() => {
        if (outcome.kind === "error") {
          const err = Object.assign(new Error(outcome.code), { code: outcome.code });
          this.emit("error", err);
        } else {
          this.emit("listening");
        }
      });
      return this;
    }

    close(cb?: () => void) {
      this.closeCalls += 1;
      setImmediate(() => cb?.());
      return this;
    }
  }

  return new FakeHttpServer();
}

describe("listenGatewayHttpServer", () => {
  beforeEach(() => {
    describePortOwnerMock.mockReset();
    describePortOwnerMock.mockResolvedValue(undefined);
    delete process.env.OPENBOT_GATEWAY_BIND_RETRIES;
    delete process.env.OPENBOT_GATEWAY_BIND_RETRY_INTERVAL_MS;
    delete process.env.OPENCLAW_GATEWAY_BIND_RETRIES;
    delete process.env.OPENCLAW_GATEWAY_BIND_RETRY_INTERVAL_MS;
  });

  afterEach(() => {
    delete process.env.OPENBOT_GATEWAY_BIND_RETRIES;
    delete process.env.OPENBOT_GATEWAY_BIND_RETRY_INTERVAL_MS;
  });

  it("retries EADDRINUSE and closes server handle before retry", async () => {
    sleepMock.mockClear();
    const fake = createFakeHttpServer([
      { kind: "error", code: "EADDRINUSE" },
      { kind: "listening" },
    ]);

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).resolves.toBeUndefined();

    expect(fake.closeCalls).toBe(1);
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });

  it("throws GatewayLockError after EADDRINUSE retries are exhausted", async () => {
    sleepMock.mockClear();
    const fake = createFakeHttpServer([
      { kind: "error", code: "EADDRINUSE" },
      { kind: "error", code: "EADDRINUSE" },
      { kind: "error", code: "EADDRINUSE" },
      { kind: "error", code: "EADDRINUSE" },
      { kind: "error", code: "EADDRINUSE" },
      { kind: "error", code: "EADDRINUSE" },
    ]);

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).rejects.toBeInstanceOf(GatewayLockError);

    expect(fake.closeCalls).toBe(4);
  });

  it("names the port holder in the exhausted-retry error", async () => {
    // A container restart race and a healthy singleton guard produce the same bind
    // error; without the holder in the message the former reads as an unexplained
    // crash loop.
    sleepMock.mockClear();
    describePortOwnerMock.mockResolvedValue("pid 4242 node openbot.mjs gateway");
    const fake = createFakeHttpServer(
      Array.from({ length: 6 }, () => ({ kind: "error", code: "EADDRINUSE" }) as const),
    );

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).rejects.toThrow(/port holder:\n[\s\S]*pid 4242 node openbot\.mjs gateway/);

    expect(describePortOwnerMock).toHaveBeenCalledWith(18789);
  });

  it("still reports the bind failure when port diagnostics are unavailable", async () => {
    sleepMock.mockClear();
    describePortOwnerMock.mockRejectedValue(new Error("lsof missing"));
    const fake = createFakeHttpServer(
      Array.from({ length: 6 }, () => ({ kind: "error", code: "EADDRINUSE" }) as const),
    );

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).rejects.toThrow(/another gateway instance is already listening/);
  });

  it("honors an enlarged retry budget from the environment", async () => {
    // Deployments that restart in place need the budget to cover the container stop
    // timeout, otherwise the successor exits and the restart policy crash-loops it.
    sleepMock.mockClear();
    process.env.OPENBOT_GATEWAY_BIND_RETRIES = "10";
    process.env.OPENBOT_GATEWAY_BIND_RETRY_INTERVAL_MS = "25";
    const fake = createFakeHttpServer([
      ...Array.from({ length: 8 }, () => ({ kind: "error", code: "EADDRINUSE" }) as const),
      { kind: "listening" },
    ]);

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).resolves.toBeUndefined();

    // Default budget is 4 retries, so this run only succeeds because the override applied.
    expect(sleepMock).toHaveBeenCalledTimes(8);
    expect(sleepMock).toHaveBeenLastCalledWith(25);
  });

  it("ignores a malformed retry override and keeps the default budget", async () => {
    sleepMock.mockClear();
    process.env.OPENBOT_GATEWAY_BIND_RETRIES = "not-a-number";
    const fake = createFakeHttpServer(
      Array.from({ length: 8 }, () => ({ kind: "error", code: "EADDRINUSE" }) as const),
    );

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).rejects.toBeInstanceOf(GatewayLockError);

    expect(fake.closeCalls).toBe(4);
  });

  it("wraps non-EADDRINUSE errors as GatewayLockError", async () => {
    sleepMock.mockClear();
    const fake = createFakeHttpServer([{ kind: "error", code: "EACCES" }]);

    await expect(
      listenGatewayHttpServer({
        httpServer: fake as unknown as HttpServer,
        bindHost: "127.0.0.1",
        port: 18789,
      }),
    ).rejects.toBeInstanceOf(GatewayLockError);

    expect(fake.closeCalls).toBe(0);
  });
});
