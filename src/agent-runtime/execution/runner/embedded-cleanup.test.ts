import { expect, it, vi } from "vitest";
import { cleanupEmbeddedRun } from "./embedded-cleanup.js";

it.each([false, true])(
  "releases timer and working directory after context disposal (failure=%s)",
  async (failure) => {
    const events: string[] = [];
    const cleanup = cleanupEmbeddedRun({
      disposeContext: async () => {
        events.push("context");
        if (failure) {
          throw new Error("dispose failed");
        }
      },
      stopCredentialRefresh: () => {
        events.push("refresh");
      },
      restoreWorkingDirectory: () => {
        events.push("cwd");
      },
    });
    if (failure) {
      await expect(cleanup).rejects.toThrow("dispose failed");
    } else {
      await expect(cleanup).resolves.toBeUndefined();
    }
    expect(events).toEqual(["context", "refresh", "cwd"]);
  },
);

it("restores the working directory even if timer cleanup fails", async () => {
  const restore = vi.fn();
  await expect(
    cleanupEmbeddedRun({
      disposeContext: () => undefined,
      stopCredentialRefresh: () => {
        throw new Error("timer failed");
      },
      restoreWorkingDirectory: restore,
    }),
  ).rejects.toThrow("timer failed");
  expect(restore).toHaveBeenCalledOnce();
});
