/** Lifecycle composition only; never starts the business heartbeat runner. */
import { startHeartbeatActivity } from "./heartbeat-activity.js";
export function createHeartbeatActivityLifecycle(options: {
  minimalTestGateway: boolean;
  subscribeBroadcast: () => () => void;
  startActivity?: () => ReturnType<typeof startHeartbeatActivity>;
}) {
  if (options.minimalTestGateway) {
    return null;
  }
  const activity = (options.startActivity ?? startHeartbeatActivity)();
  let broadcastStop: (() => void) | undefined;
  try {
    broadcastStop = options.subscribeBroadcast();
  } catch (error) {
    activity.stop();
    throw error;
  }
  let stopped = false;
  return () => {
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
}
