import { describe, expect, it } from "vitest";
import type { ChannelAccountSnapshot } from "../channels/plugins/types.js";
import type { ChannelManager, ChannelRuntimeSnapshot } from "./server-channels.js";
import {
  AUTH_TOKEN,
  AUTH_NONE,
  createRequest,
  createResponse,
  dispatchRequest,
  sendRequest,
  withGatewayServer,
} from "./server-http.test-harness.js";
import { createReadinessChecker, type ReadinessChecker } from "./server/readiness.js";

describe("gateway probe endpoints", () => {
  it("returns detailed readiness payload for local /ready requests", async () => {
    const getReadiness: ReadinessChecker = () => ({
      ready: true,
      failing: [],
      uptimeMs: 45_000,
    });

    await withGatewayServer({
      prefix: "probe-ready",
      resolvedAuth: AUTH_NONE,
      overrides: { getReadiness },
      run: async (server) => {
        const req = createRequest({ path: "/ready" });
        const { res, getBody } = createResponse();
        await dispatchRequest(server, req, res);

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(getBody())).toEqual({ ready: true, failing: [], uptimeMs: 45_000 });
      },
    });
  });

  it("returns only readiness state for unauthenticated remote /ready requests", async () => {
    const getReadiness: ReadinessChecker = () => ({
      ready: false,
      failing: ["discord", "telegram"],
      uptimeMs: 8_000,
    });

    await withGatewayServer({
      prefix: "probe-not-ready",
      resolvedAuth: AUTH_NONE,
      overrides: { getReadiness },
      run: async (server) => {
        const req = createRequest({
          path: "/ready",
          remoteAddress: "10.0.0.8",
          host: "gateway.test",
        });
        const { res, getBody } = createResponse();
        await dispatchRequest(server, req, res);

        expect(res.statusCode).toBe(503);
        expect(JSON.parse(getBody())).toEqual({ ready: false });
      },
    });
  });

  it("returns detailed readiness payload for authenticated remote /ready requests", async () => {
    const getReadiness: ReadinessChecker = () => ({
      ready: false,
      failing: ["discord", "telegram"],
      uptimeMs: 8_000,
    });

    await withGatewayServer({
      prefix: "probe-remote-authenticated",
      resolvedAuth: AUTH_TOKEN,
      overrides: { getReadiness },
      run: async (server) => {
        const req = createRequest({
          path: "/ready",
          remoteAddress: "10.0.0.8",
          host: "gateway.test",
          authorization: "Bearer test-token",
        });
        const { res, getBody } = createResponse();
        await dispatchRequest(server, req, res);

        expect(res.statusCode).toBe(503);
        expect(JSON.parse(getBody())).toEqual({
          ready: false,
          failing: ["discord", "telegram"],
          uptimeMs: 8_000,
        });
      },
    });
  });

  it("returns typed internal error payload when readiness evaluation throws", async () => {
    const getReadiness: ReadinessChecker = () => {
      throw new Error("boom");
    };

    await withGatewayServer({
      prefix: "probe-throws",
      resolvedAuth: AUTH_NONE,
      overrides: { getReadiness },
      run: async (server) => {
        const req = createRequest({ path: "/ready" });
        const { res, getBody } = createResponse();
        await dispatchRequest(server, req, res);

        expect(res.statusCode).toBe(503);
        expect(JSON.parse(getBody())).toEqual({ ready: false, failing: ["internal"], uptimeMs: 0 });
      },
    });
  });

  it("keeps /healthz shallow even when readiness checker reports failing channels", async () => {
    const getReadiness: ReadinessChecker = () => ({
      ready: false,
      failing: ["discord"],
      uptimeMs: 999,
    });

    await withGatewayServer({
      prefix: "probe-healthz-unaffected",
      resolvedAuth: AUTH_NONE,
      overrides: { getReadiness },
      run: async (server) => {
        const req = createRequest({ path: "/healthz" });
        const { res, getBody } = createResponse();
        await dispatchRequest(server, req, res);

        expect(res.statusCode).toBe(200);
        expect(getBody()).toBe(JSON.stringify({ ok: true, status: "live" }));
      },
    });
  });

  it("reflects readiness status on HEAD /readyz without a response body", async () => {
    const getReadiness: ReadinessChecker = () => ({
      ready: false,
      failing: ["discord"],
      uptimeMs: 5_000,
    });

    await withGatewayServer({
      prefix: "probe-readyz-head",
      resolvedAuth: AUTH_NONE,
      overrides: { getReadiness },
      run: async (server) => {
        const req = createRequest({ path: "/readyz", method: "HEAD" });
        const { res, getBody } = createResponse();
        await dispatchRequest(server, req, res);

        expect(res.statusCode).toBe(503);
        expect(getBody()).toBe("");
      },
    });
  });

  it("returns 503 from ready probes after channel grace while liveness stays up", async () => {
    // Intentional: a managed channel that is still disconnected after startup
    // grace fails /ready and /readyz. /health and /healthz stay live.
    // See docs/gateway/health.md. Probe semantics are unchanged.
    const startedAt = Date.now() - 5 * 60_000;
    const discord = {
      accountId: "default",
      running: true,
      connected: false,
      enabled: true,
      configured: true,
      lastStartAt: startedAt,
    } as ChannelAccountSnapshot;
    const snapshot: ChannelRuntimeSnapshot = {
      channels: { discord: discord },
      channelAccounts: { discord: { default: discord } },
    };
    const channelManager: ChannelManager = {
      getRuntimeSnapshot: () => snapshot,
      startChannels: async () => {},
      startChannel: async () => {},
      stopChannel: async () => {},
      markChannelLoggedOut: () => {},
      isManuallyStopped: () => false,
      resetRestartAttempts: () => {},
    };
    const getReadiness = createReadinessChecker({
      channelManager,
      startedAt,
      cacheTtlMs: 0,
    });

    await withGatewayServer({
      prefix: "probe-channel-down-after-grace",
      resolvedAuth: AUTH_NONE,
      overrides: { getReadiness },
      run: async (server) => {
        for (const path of ["/ready", "/readyz"] as const) {
          const response = await sendRequest(server, { path });
          expect(response.res.statusCode, path).toBe(503);
          const body = JSON.parse(response.getBody()) as {
            ready: boolean;
            failing: string[];
            uptimeMs: number;
          };
          expect(body.ready, path).toBe(false);
          expect(body.failing, path).toEqual(["discord"]);
          expect(body.uptimeMs, path).toBeGreaterThanOrEqual(5 * 60_000);
        }
        for (const path of ["/health", "/healthz"] as const) {
          const response = await sendRequest(server, { path });
          expect(response.res.statusCode, path).toBe(200);
          expect(JSON.parse(response.getBody()), path).toEqual({ ok: true, status: "live" });
        }
      },
    });
  });
});
