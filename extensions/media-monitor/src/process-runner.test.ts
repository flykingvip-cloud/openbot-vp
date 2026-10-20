import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildCrawlArgv } from "./contract.js";
import { runAdapterProcess } from "./process-runner.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-adapter.mjs",
);

afterEach(() => {
  delete process.env.FAKE_ADAPTER_SCENARIO;
  delete process.env.FAKE_ADAPTER_SLEEP_MS;
});

describe("media-monitor process-runner", () => {
  it("runs fixture adapter and parses JSONL stdout", async () => {
    process.env.FAKE_ADAPTER_SCENARIO = "new_content";
    const result = await runAdapterProcess({
      command: ["node", fixturePath],
      extraArgv: buildCrawlArgv({
        platform: "xhs",
        accountId: "a1",
        mode: "creator",
      }),
      timeoutMs: 10_000,
      maxStdoutBytes: 1_000_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("items" in result.envelope).toBe(true);
    }
  });

  it("classifies timeout", async () => {
    const result = await runAdapterProcess({
      command: ["node", fixturePath],
      extraArgv: [
        ...buildCrawlArgv({
          platform: "xhs",
          accountId: "a1",
          mode: "creator",
        }),
        "--scenario",
        "timeout",
      ],
      timeoutMs: 400,
      maxStdoutBytes: 1_000_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("timeout");
    }
  });

  it("classifies invalid output", async () => {
    process.env.FAKE_ADAPTER_SCENARIO = "invalid_json";
    const result = await runAdapterProcess({
      command: ["node", fixturePath],
      extraArgv: buildCrawlArgv({
        platform: "xhs",
        accountId: "a1",
        mode: "creator",
      }),
      timeoutMs: 10_000,
      maxStdoutBytes: 1_000_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("invalid_output");
    }
  });

  it("handles AbortSignal that is already aborted without throwing", async () => {
    process.env.FAKE_ADAPTER_SCENARIO = "timeout";
    const controller = new AbortController();
    controller.abort();
    const result = await runAdapterProcess({
      command: ["node", fixturePath],
      extraArgv: buildCrawlArgv({
        platform: "xhs",
        accountId: "a1",
        mode: "creator",
      }),
      timeoutMs: 10_000,
      maxStdoutBytes: 1_000_000,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("adapter cancelled");
    }
  });
});
