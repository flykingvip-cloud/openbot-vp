import { expect, it, vi } from "vitest";
import { cancelAdmittedRuntime, registerRuntimeCancellation } from "./runtime-cancellation.js";
it("cancels only exact admitted session/task registrations and removes released owners", async () => {
  const cancel = vi.fn(async () => true);
  const remove = registerRuntimeCancellation("session", "task", cancel);
  try {
    await cancelAdmittedRuntime("other-session", "task");
    await cancelAdmittedRuntime("session", "other-task");
    expect(cancel).not.toHaveBeenCalled();
    await cancelAdmittedRuntime("session", "task");
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    remove();
  }
  await cancelAdmittedRuntime("session", "task");
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("surfaces transaction failures without silently reporting cancellation", async () => {
  const remove = registerRuntimeCancellation("s", "t", async () => {
    throw new Error("db offline");
  });
  try {
    await expect(cancelAdmittedRuntime("s", "t")).rejects.toThrow("transaction failed");
  } finally {
    remove();
  }
});
