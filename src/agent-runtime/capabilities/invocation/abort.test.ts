import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../../../agents/pi-tools.types.js";
import { wrapToolWithAbortSignal } from "./abort.js";

function setup() {
  const execute = vi.fn<AnyAgentTool["execute"]>().mockResolvedValue({ content: [], details: {} });
  const tool: AnyAgentTool = {
    name: "test",
    label: "test",
    description: "test",
    parameters: Type.Object({}),
    execute,
  };
  return { tool, execute };
}

describe("capability cancellation composition", () => {
  it("preserves the tool when no run signal is supplied", () => {
    const { tool } = setup();
    expect(wrapToolWithAbortSignal(tool)).toBe(tool);
  });

  it.each(["run", "call"])(
    "rejects a pre-aborted %s before invoking the capability",
    async (source) => {
      const { tool, execute } = setup();
      const run = new AbortController();
      const call = new AbortController();
      (source === "run" ? run : call).abort();
      await expect(
        wrapToolWithAbortSignal(tool, run.signal).execute("id", {}, call.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each(["run", "call"])(
    "forwards %s cancellation to the same capability invocation",
    async (source) => {
      const { tool, execute } = setup();
      const run = new AbortController();
      const call = new AbortController();
      const update = vi.fn();
      await wrapToolWithAbortSignal(tool, run.signal).execute("id", {}, call.signal, update);
      const signal = execute.mock.calls[0][2];
      expect(signal?.aborted).toBe(false);
      (source === "run" ? run : call).abort();
      expect(signal?.aborted).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0][3]).toBe(update);
    },
  );
});
