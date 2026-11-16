import { describe, expect, it, vi } from "vitest";
import { emitHeartbeatEvent } from "../infra/heartbeat-events.js";
import { createHeartbeatActivityLifecycle } from "./heartbeat-activity-lifecycle.js";
import { startHeartbeatActivity } from "./heartbeat-activity.js";
describe("heartbeat activity gateway lifecycle composition", () => {
  it("does not construct or subscribe in minimal gateways", () => {
    const startActivity = vi.fn();
    const subscribeBroadcast = vi.fn();
    expect(
      createHeartbeatActivityLifecycle({
        minimalTestGateway: true,
        startActivity,
        subscribeBroadcast,
      }),
    ).toBeNull();
    expect(startActivity).not.toHaveBeenCalled();
    expect(subscribeBroadcast).not.toHaveBeenCalled();
  });
  it("keeps disabled activity unsubscribed and closes idempotently", () => {
    const subscribe = vi.fn(() => () => {});
    const broadcastStop = vi.fn();
    const stop = createHeartbeatActivityLifecycle({
      minimalTestGateway: false,
      subscribeBroadcast: () => broadcastStop,
      startActivity: () => startHeartbeatActivity({ enabled: () => false, subscribe }),
    });
    expect(subscribe).not.toHaveBeenCalled();
    stop?.stop();
    stop?.stop();
    expect(broadcastStop).toHaveBeenCalledTimes(1);
  });
  it("passively captures enabled activity and disposes even if broadcast cleanup throws", () => {
    const activity = startHeartbeatActivity({ enabled: () => true });
    const stop = createHeartbeatActivityLifecycle({
      minimalTestGateway: false,
      startActivity: () => activity,
      subscribeBroadcast: () => () => {
        throw new Error("cleanup");
      },
    });
    emitHeartbeatEvent({ status: "skipped" });
    expect(activity.query().events).toHaveLength(1);
    expect(() => stop?.stop()).toThrow("cleanup");
    expect(activity.query().events).toEqual([]);
    expect(() => stop?.stop()).not.toThrow();
  });
  it("enables collection on a real gateway when the env flag is unset", () => {
    vi.stubEnv("OPENBOT_HEARTBEAT_ACTIVITY_OBSERVATION", "");
    const enabled = createHeartbeatActivityLifecycle({
      minimalTestGateway: false,
      subscribeBroadcast: () => () => {},
    });
    expect(enabled?.query().collectorState).toBe("collecting");
    enabled?.stop();
    vi.unstubAllEnvs();
  });
});
