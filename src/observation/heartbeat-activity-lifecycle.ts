/** Lifecycle composition only; never starts the business heartbeat runner. */
import { HEARTBEAT_ACTIVITY_FLAG, startHeartbeatActivity } from "./heartbeat-activity.js";
export function createHeartbeatActivityLifecycle(options: {
  minimalTestGateway: boolean;
  subscribeBroadcast: () => () => void;
  startActivity?: () => ReturnType<typeof startHeartbeatActivity>;
  resolveExpectedPeriodMs?: () => number | null;
}) {
  if (options.minimalTestGateway) {
    return null;
  }
  const activity = (
    options.startActivity ??
    (() =>
      startHeartbeatActivity({
        enabled: () => {
          const raw = process.env[HEARTBEAT_ACTIVITY_FLAG]?.trim() ?? "";
          if (!raw) {
            return true;
          }
          return /^(1|true|yes|on)$/i.test(raw);
        },
        resolveExpectedPeriodMs: options.resolveExpectedPeriodMs,
      }))
  )();
  let broadcastStop: (() => void) | undefined;
  try {
    broadcastStop = options.subscribeBroadcast();
  } catch (error) {
    activity.stop();
    throw error;
  }
  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      broadcastStop?.();
    } finally {
      activity.stop();
    }
  };
  return { stop, query: () => activity.query() };
}
