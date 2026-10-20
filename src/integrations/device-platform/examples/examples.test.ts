import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_CONTROL_BASE_URL,
  DEFAULT_OPENBOT_BASE_URL,
  DEVICE_CONTROL_OPENAPI_RAW_URL,
  OPENBOT_CONTRACT_SHA,
  OPENBOT_OPENAPI_RAW_URL,
  assertSeparateControlOrigin,
  runJointHarness,
  startFakeDeviceControl,
} from "./joint-harness.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

const COPIED_SECRET_MARKERS = ["service-secret-16+", "consent-secret-16+"];

describe("device platform joint harness", () => {
  it("drives me list, add, rebind, and revoke through the control client", async () => {
    const report = await runJointHarness();
    expect(report.listedBefore).toBe(0);
    expect(report.deviceId).toMatch(/^dev_/);
    expect(report.reboundDigitalHumanId).toBe("dh-shared");
    expect(report.revoked).toBe(true);
    expect(report.restartedListed).toBe(true);
    expect(report.callsDuringRestart).toBe(0);
    expect(report.grayRelease).toBe(false);
    expect(report.bindGrant?.startsWith("obgc_")).toBe(true);
    expect(report.authorizationRef?.startsWith("azr_")).toBe(true);
    expect(report.controlBaseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(report.controlBaseUrl).not.toBe(DEFAULT_OPENBOT_BASE_URL);
  });

  it("mirrors pair redeem rules and refuses a bind without a grant", async () => {
    const platform = await startFakeDeviceControl();
    try {
      const auth = `Basic ${Buffer.from("device-platform:harness-only-secret", "utf8").toString("base64")}`;
      const redeem = await fetch(
        `${platform.baseUrl}/api/device-platform/v1/pair-challenges/pch_jointchallenge/redeem`,
        {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json" },
          body: JSON.stringify({ deviceId: "cam-1", pairingCode: "123456" }),
        },
      );
      expect(redeem.status).toBe(200);
      const replay = await fetch(
        `${platform.baseUrl}/api/device-platform/v1/pair-challenges/pch_jointchallenge/redeem`,
        {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json" },
          body: JSON.stringify({ deviceId: "cam-1", pairingCode: "123456" }),
        },
      );
      expect(replay.status).toBe(200);
      const other = await fetch(
        `${platform.baseUrl}/api/device-platform/v1/pair-challenges/pch_jointchallenge/redeem`,
        {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json" },
          body: JSON.stringify({ deviceId: "cam-1", pairingCode: "654321" }),
        },
      );
      expect(other.status).toBe(400);
      const minted = await fetch(`${platform.baseUrl}/api/device-platform/v1/devices/cam-1/bind`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(minted.status).toBe(401);
      const integrations = await fetch(`${platform.baseUrl}/api/integrations/v1/health`, {
        headers: { authorization: auth },
      });
      expect(integrations.status).toBe(404);
    } finally {
      await platform.close();
    }
  });

  it("rejects a connector origin that is the OpenBot host", () => {
    expect(() =>
      assertSeparateControlOrigin("http://127.0.0.1:18789", "http://127.0.0.1:18789"),
    ).toThrow(/collides/);
    expect(() =>
      assertSeparateControlOrigin(DEFAULT_OPENBOT_BASE_URL, DEFAULT_DEVICE_CONTROL_BASE_URL),
    ).not.toThrow();
  });

  it("keeps secrets out of the runbook and the shell example", () => {
    const staging = fs.readFileSync(
      path.join(repoRoot, "docs/integrations/device-platform/staging.md"),
      "utf8",
    );
    const script = fs.readFileSync(path.join(here, "joint.sh"), "utf8");
    const combined = `${staging}\n${script}`;
    expect(staging).toContain(DEFAULT_DEVICE_CONTROL_BASE_URL);
    expect(staging).toContain(OPENBOT_CONTRACT_SHA);
    expect(staging).toContain("Historical only, not the pin");
    expect(staging).not.toContain("`OPENBOT_CONTRACT_SHA`: `92826116");
    expect(staging).toContain(OPENBOT_OPENAPI_RAW_URL);
    expect(staging).toContain(DEVICE_CONTROL_OPENAPI_RAW_URL);
    expect(staging).toContain("OPENBOT_STUB_SERVICE_USER");
    expect(staging).toContain("OPENBOT_STUB_SERVICE_PASSWORD");
    expect(staging).toContain("JOINT_PENDING");
    expect(staging).toContain("grayRelease");
    expect(script).toContain("http://127.0.0.1:8791");
    for (const marker of COPIED_SECRET_MARKERS) {
      expect(combined).not.toContain(marker);
    }
    expect(script).not.toContain("harness-only-secret");
  });

  it("prints the curl sequence and runs the harness script", async () => {
    const printed = await execFileAsync("bash", [path.join(here, "joint.sh"), "--print"], {
      env: process.env,
    });
    expect(printed.stdout).toContain("http://127.0.0.1:8791");
    expect(printed.stdout).toContain("/api/device-platform/v1/me/devices");
    expect(printed.stdout).toContain('kind":"rebind');
    expect(printed.stdout).toContain('kind":"revoke');
    expect(printed.stdout).not.toContain("harness-only-secret");

    const harness = await execFileAsync("bash", [path.join(here, "joint.sh")], {
      env: { ...process.env, OPENBOT_DEVICE_PLATFORM_JOINT: "harness" },
      timeout: 30_000,
    });
    expect(harness.stdout).toContain("harness ok");
    expect(harness.stdout).toContain("JOINT_PENDING cross-host hardware");
    expect(harness.stdout).toContain(OPENBOT_CONTRACT_SHA);
  }, 30_000);
});
