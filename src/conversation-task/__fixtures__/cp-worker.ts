/**
 * Test fixture (not a unit test): a child process that reads or mutates the
 * shared, persistent activation control plane. Used by store-crossproc.test.ts to
 * prove the force-off state and the controlled reopen are durable + shared ACROSS
 * PROCESSES.
 *
 * argv:
 *   forceOff <storeRoot> <reason>
 *   reopen   <storeRoot> <actorId>
 *   read     <storeRoot>          -> stdout {"forcedOff": <boolean>}
 *
 * Uses minReopenIntervalMs=0 so the cross-process reopen is not gated on wall time
 * (this fixture proves visibility, not the cooldown, which control-plane.test.ts
 * covers).
 */

import { SqliteActivationControlPlane } from "../control-plane.js";

function main(): void {
  const [action, storeRoot, arg] = process.argv.slice(2);
  const cp = new SqliteActivationControlPlane({ storeRoot, minReopenIntervalMs: 0 });
  if (action === "forceOff") {
    cp.forceOff({ reason: arg ?? "degrade-from-child" });
  } else if (action === "reopen") {
    cp.attemptReopen({ confirmedByHuman: true, actorId: arg ?? "op-child" });
  } else if (action === "read") {
    process.stdout.write(`${JSON.stringify({ forcedOff: cp.isForcedOff() })}\n`);
  }
  cp.close();
}

main();
