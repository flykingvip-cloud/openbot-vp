/**
 * CollabDispatch Sprint D4 — lightweight seat/concurrency alignment.
 *
 * After organizer confirm, delivery must not be stranded by a hard concurrency
 * deny. This gate serializes/limits in-flight broadcast deliveries per key
 * (tenant or seat) by queueing rather than rejecting — no redesign of the
 * global concurrency system.
 */

type GateState = {
  active: number;
  waiters: Array<() => void>;
};

const gates = new Map<string, GateState>();

const DEFAULT_MAX_CONCURRENT = 4;

function getGate(key: string): GateState {
  let gate = gates.get(key);
  if (!gate) {
    gate = { active: 0, waiters: [] };
    gates.set(key, gate);
  }
  return gate;
}

/**
 * Run `fn` under a per-key concurrency limit. Waits (does not fail) when at
 * capacity so a confirmed release can still deliver.
 */
export async function withCollabDispatchDeliveryCapacity<T>(params: {
  key: string;
  maxConcurrent?: number;
  run: () => Promise<T>;
}): Promise<T> {
  const key = params.key.trim() || "default";
  const max = Math.max(1, params.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const gate = getGate(key);

  if (gate.active >= max) {
    await new Promise<void>((resolve) => {
      gate.waiters.push(resolve);
    });
  }
  gate.active += 1;
  try {
    return await params.run();
  } finally {
    gate.active = Math.max(0, gate.active - 1);
    const next = gate.waiters.shift();
    if (next) {
      next();
    } else if (gate.active === 0 && gate.waiters.length === 0) {
      gates.delete(key);
    }
  }
}

/** Test helper. */
export function __resetCollabDispatchDeliveryGatesForTest(): void {
  gates.clear();
}
