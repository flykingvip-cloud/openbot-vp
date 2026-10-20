import { describe, expect, it } from "vitest";
import { LEGACY_GATEWAY_WINDOWS_TASK_NAMES } from "../compat/legacy-names.js";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

const LEGACY_WINDOWS_TASK_NAME = LEGACY_GATEWAY_WINDOWS_TASK_NAMES[0];

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          OPENCLAW_STATE_DIR: "/tmp/openclaw-state",
          OPENCLAW_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "openbot-gateway",
        windowsTaskName: LEGACY_WINDOWS_TASK_NAME,
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/openclaw-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/openclaw-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "openbot-gateway",
        windowsTaskName: LEGACY_WINDOWS_TASK_NAME,
      }),
    ).toEqual(["Logs: journalctl --user -u openbot-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "openbot-gateway",
        windowsTaskName: LEGACY_WINDOWS_TASK_NAME,
      }),
    ).toEqual([`Logs: schtasks /Query /TN "${LEGACY_WINDOWS_TASK_NAME}" /V /FO LIST`]);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "openbot gateway install",
        startCommand: "openbot gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.openbot.gateway.plist",
        systemdServiceName: "openbot-gateway",
        windowsTaskName: LEGACY_WINDOWS_TASK_NAME,
      }),
    ).toEqual([
      "openbot gateway install",
      "openbot gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.openbot.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "openbot gateway install",
        startCommand: "openbot gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.openbot.gateway.plist",
        systemdServiceName: "openbot-gateway",
        windowsTaskName: LEGACY_WINDOWS_TASK_NAME,
      }),
    ).toEqual([
      "openbot gateway install",
      "openbot gateway",
      "systemctl --user start openbot-gateway.service",
    ]);
  });
});
