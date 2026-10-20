import { describe, expect, it } from "vitest";
import { LEGACY_GATEWAY_WINDOWS_TASK_NAMES } from "../compat/legacy-names.js";
import { buildSystemdUnit } from "./systemd-unit.js";

const LEGACY_WINDOWS_TASK_NAME = LEGACY_GATEWAY_WINDOWS_TASK_NAMES[0];

describe("buildSystemdUnit", () => {
  it("quotes arguments with whitespace", () => {
    const unit = buildSystemdUnit({
      description: LEGACY_WINDOWS_TASK_NAME,
      programArguments: ["/usr/bin/openbot", "gateway", "--name", "My Bot"],
      environment: {},
    });
    const execStart = unit.split("\n").find((line) => line.startsWith("ExecStart="));
    expect(execStart).toBe('ExecStart=/usr/bin/openbot gateway --name "My Bot"');
  });

  it("renders control-group kill mode for child-process cleanup", () => {
    const unit = buildSystemdUnit({
      description: LEGACY_WINDOWS_TASK_NAME,
      programArguments: ["/usr/bin/openbot", "gateway", "run"],
      environment: {},
    });
    expect(unit).toContain("KillMode=control-group");
    expect(unit).toContain("TimeoutStopSec=30");
    expect(unit).toContain("TimeoutStartSec=30");
    expect(unit).toContain("SuccessExitStatus=0 143");
  });

  it("rejects environment values with line breaks", () => {
    expect(() =>
      buildSystemdUnit({
        description: LEGACY_WINDOWS_TASK_NAME,
        programArguments: ["/usr/bin/openbot", "gateway", "start"],
        environment: {
          INJECT: "ok\nExecStartPre=/bin/touch /tmp/oc15789_rce",
        },
      }),
    ).toThrow(/CR or LF/);
  });
});
