import { afterEach, expect, it, vi } from "vitest";
import * as legacy from "../../../agents/pi-embedded-runner/runs.js";
import * as runtime from "./run-registry.js";

afterEach(() => runtime.__testing.resetActiveEmbeddedRuns());

it("shares one registry across the legacy facade and runtime", async () => {
  expect(legacy.setActiveEmbeddedRun).toBe(runtime.setActiveEmbeddedRun);
  const handle = {
    queueMessage: vi.fn(async () => {}),
    isStreaming: () => true,
    isCompacting: () => false,
    abort: vi.fn(),
  };
  runtime.setActiveEmbeddedRun("shared", handle);
  expect(legacy.isEmbeddedPiRunActive("shared")).toBe(true);
  expect(legacy.queueEmbeddedPiMessage("shared", "amendment")).toBe(true);
  expect(handle.queueMessage).toHaveBeenCalledWith("amendment");
  expect(legacy.abortEmbeddedPiRun("shared")).toBe(true);
  expect(handle.abort).toHaveBeenCalledOnce();
  const ended = legacy.waitForEmbeddedPiRunEnd("shared");
  runtime.clearActiveEmbeddedRun("shared", handle);
  await expect(ended).resolves.toBe(true);
  expect(runtime.getActiveEmbeddedRunCount()).toBe(0);
});

it("does not let obsolete cleanup remove a replacement run", () => {
  const createHandle = () => ({
    queueMessage: async () => {},
    isStreaming: () => true,
    isCompacting: () => false,
    abort: vi.fn(),
  });
  const old = createHandle();
  const current = createHandle();
  legacy.setActiveEmbeddedRun("replaced", old);
  runtime.setActiveEmbeddedRun("replaced", current);
  legacy.clearActiveEmbeddedRun("replaced", old);
  expect(runtime.isEmbeddedPiRunActive("replaced")).toBe(true);
  legacy.abortEmbeddedPiRun("replaced");
  expect(current.abort).toHaveBeenCalledOnce();
  expect(old.abort).not.toHaveBeenCalled();
});
