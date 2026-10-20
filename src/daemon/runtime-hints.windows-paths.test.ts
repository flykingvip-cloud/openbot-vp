import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGACY_GATEWAY_WINDOWS_TASK_NAMES } from "../compat/legacy-names.js";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./launchd.js");
});

describe("buildPlatformRuntimeLogHints", () => {
  it("strips windows drive prefixes from darwin display paths", async () => {
    vi.doMock("./launchd.js", () => ({
      resolveGatewayLogPaths: () => ({
        stdoutPath: "C:\\tmp\\openclaw-state\\logs\\gateway.log",
        stderrPath: "C:\\tmp\\openclaw-state\\logs\\gateway.err.log",
      }),
    }));

    const { buildPlatformRuntimeLogHints } = await import("./runtime-hints.js");

    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        systemdServiceName: "openbot-gateway",
        windowsTaskName: LEGACY_GATEWAY_WINDOWS_TASK_NAMES[0],
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/openclaw-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/openclaw-state/logs/gateway.err.log",
    ]);
  });
});
