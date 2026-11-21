import { afterEach, expect, it, vi } from "vitest";
import {
  registerRuntimeLease,
  startRuntimeLeaseAdmission,
  stopRuntimeLeases,
} from "./runtime-lease-registry.js";
afterEach(async () => {
  await stopRuntimeLeases();
  startRuntimeLeaseAdmission();
});
it("drains deferred leases and refuses admission until startup reopens it", async () => {
  const cleanup = vi.fn(async () => {
    unregister();
  });
  const unregister = registerRuntimeLease(cleanup);
  await stopRuntimeLeases();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(() => registerRuntimeLease(async () => {})).toThrow("stopping");
  startRuntimeLeaseAdmission();
  registerRuntimeLease(async () => {})();
});
