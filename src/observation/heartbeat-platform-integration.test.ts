import { describe, expect, it } from "vitest";
import type {
  GatewayClient,
  GatewayRequestHandlerOptions,
} from "../gateway/server-methods/types.js";
import { emitHeartbeatEvent } from "../infra/heartbeat-events.js";
import { createHeartbeatActivityLifecycle } from "./heartbeat-activity-lifecycle.js";
import { startHeartbeatActivity } from "./heartbeat-activity.js";
import { createObservationQueryHandlers, OBSERVATION_QUERY_METHOD } from "./query-gateway.js";
describe("same server collector platform read", () => {
  it("reads real passive events through the existing handler and clears on close", async () => {
    const lifecycle = createHeartbeatActivityLifecycle({
      minimalTestGateway: false,
      subscribeBroadcast: () => () => {},
      startActivity: () => startHeartbeatActivity({ enabled: () => true }),
    });
    const handler = createObservationQueryHandlers({
      platformActivityCollector: lifecycle,
      authDeps: { resolveMembership: async () => ({ tenantId: null, userId: "platform-user" }) },
    })[OBSERVATION_QUERY_METHOD];
    const client = {
      platformUserId: "platform-user",
      sessionDomain: "platform",
      sessionKind: "platform-admin",
      connect: { scopes: ["operator.read", "operator.platform"] },
    } as GatewayClient;
    const read = async (params: Record<string, unknown> = { platformActivity: true }) => {
      let result: unknown;
      await handler({
        client,
        params,
        respond: (ok: boolean, payload: unknown) => {
          result = { ok, payload };
        },
      } as unknown as GatewayRequestHandlerOptions);
      return result as { ok: boolean; payload: { activity: { events: unknown[] } } };
    };
    emitHeartbeatEvent({ status: "sent", preview: "SECRET" });
    expect((await read()).payload.activity.events).toHaveLength(1);
    expect((await read({ platformActivity: true, taskId: "fake" })).ok).toBe(false);
    client.sessionDomain = "enterprise";
    expect((await read()).ok).toBe(false);
    client.sessionDomain = "platform";
    lifecycle?.stop();
    lifecycle?.stop();
    emitHeartbeatEvent({ status: "failed" });
    expect((await read()).payload.activity.events).toEqual([]);
  });
  it("does not create a replacement collector for minimal gateways", async () => {
    const lifecycle = createHeartbeatActivityLifecycle({
      minimalTestGateway: true,
      subscribeBroadcast: () => () => {},
    });
    const handler = createObservationQueryHandlers({
      platformActivityCollector: lifecycle,
      authDeps: { resolveMembership: async () => ({ tenantId: null, userId: "p" }) },
    })[OBSERVATION_QUERY_METHOD];
    let ok = true;
    await handler({
      client: {
        platformUserId: "p",
        sessionDomain: "platform",
        sessionKind: "platform-admin",
        connect: { scopes: ["operator.read", "operator.platform"] },
      },
      params: { platformActivity: true },
      respond: (value: boolean) => {
        ok = value;
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(ok).toBe(false);
  });
});
