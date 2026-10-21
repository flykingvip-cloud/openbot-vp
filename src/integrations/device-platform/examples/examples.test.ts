import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  CONTROL_FREEZE_SHA,
  DEFAULT_DEVICE_CONTROL_BASE_URL,
  DEFAULT_OPENBOT_BASE_URL,
  DEFAULT_STUB_BASE_URL,
  DEVICE_CONTROL_OPENAPI_PATH,
  DEVICE_CONTROL_OPENAPI_RAW_URL,
  DEVICE_SDK_DOCS_MERGE_PREFIX,
  DEVICE_SDK_MAIN_TIP,
  DEVICE_SDK_V1_FROZEN_PR,
  OPENBOT_CONTRACT_SHA,
  OPENBOT_OPENAPI_RAW_URL,
  assertMockJointOrder,
  assertSeparateControlOrigin,
  runJointHarness,
  simulateVoiceAndPhoto,
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
    expect(report.adminHealthOk).toBe(true);
    expect(report.bindingId).toMatch(/^bind_/);
    expect(report.sameBindingOnHumanA).toBe(true);
    expect(report.reboundDigitalHumanId).toBe("dh-b");
    expect(report.sameBindingOnHumanB).toBe(true);
    expect(report.humanAClearedAfterRebind).toBe(true);
    expect(report.revoked).toBe(true);
    expect(report.personalClearedAfterRevoke).toBe(true);
    expect(report.humanBClearedAfterRevoke).toBe(true);
    expect(report.grantStatusAfterRevoke).toBe("revoked");
    expect(report.oldAuthCannotExecute).toBe(true);
    expect(report.capabilityRejectedAfterRevoke).toBe(true);
    expect(report.restartedListed).toBe(true);
    expect(report.callsDuringRestart).toBe(0);
    expect(report.grayRelease).toBe(false);
    expect(report.realDeviceDelivery).toBe(false);
    expect(report.voicePhoto).toEqual({
      tier: "模拟",
      voice: "stub",
      photo: "stub",
      deviceEffect: false,
      hardware: false,
    });
    expect(report.bindGrant?.startsWith("obgc_")).toBe(true);
    expect(report.authorizationRef?.startsWith("azr_")).toBe(true);
    expect(report.controlBaseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(report.stubBaseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(report.controlBaseUrl).not.toBe(DEFAULT_OPENBOT_BASE_URL);
    expect(report.controlBaseUrl).not.toBe(report.stubBaseUrl);
    expect(report.documentedControlBaseUrl).toBe(DEFAULT_DEVICE_CONTROL_BASE_URL);
    expect(report.documentedStubBaseUrl).toBe(DEFAULT_STUB_BASE_URL);
    expect(report.documentedOpenBotBaseUrl).toBe(DEFAULT_OPENBOT_BASE_URL);
    expect(() => assertMockJointOrder(report.trace)).not.toThrow();
  });

  it("refuses to treat a voice or photo stub as a real device", () => {
    expect(
      simulateVoiceAndPhoto({ grayRelease: false, realDeviceDelivery: false }).deviceEffect,
    ).toBe(false);
    expect(() => simulateVoiceAndPhoto({ grayRelease: true, realDeviceDelivery: false })).toThrow(
      /真机/,
    );
    expect(() => simulateVoiceAndPhoto({ grayRelease: false, realDeviceDelivery: true })).toThrow(
      /真机/,
    );
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
    expect(() =>
      assertSeparateControlOrigin(DEFAULT_DEVICE_CONTROL_BASE_URL, DEFAULT_STUB_BASE_URL),
    ).not.toThrow();
  });

  it("keeps secrets out of the runbook and the shell example", () => {
    const staging = fs.readFileSync(
      path.join(repoRoot, "docs/integrations/device-platform/staging.md"),
      "utf8",
    );
    const acceptance = fs.readFileSync(
      path.join(repoRoot, "docs/integrations/device-platform/joint-acceptance.md"),
      "utf8",
    );
    const script = fs.readFileSync(path.join(here, "joint.sh"), "utf8");
    const combined = `${staging}\n${acceptance}\n${script}`;
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
    expect(acceptance).toContain(OPENBOT_CONTRACT_SHA);
    expect(acceptance).toContain(DEVICE_SDK_MAIN_TIP);
    expect(acceptance).toContain(DEVICE_SDK_DOCS_MERGE_PREFIX);
    expect(acceptance).toContain(DEVICE_SDK_V1_FROZEN_PR);
    expect(acceptance).toContain(`CONTROL_FREEZE_SHA=${CONTROL_FREEZE_SHA}`);
    expect(acceptance).toContain(DEVICE_CONTROL_OPENAPI_PATH);
    expect(acceptance).toContain(DEFAULT_DEVICE_CONTROL_BASE_URL);
    expect(acceptance).toContain(DEFAULT_STUB_BASE_URL);
    expect(acceptance).toContain("代码检查");
    expect(acceptance).toContain("模拟");
    expect(acceptance).toContain("staging");
    expect(acceptance).toContain("真机");
    expect(acceptance).toContain("生产");
    expect(acceptance).toContain("管理页面可操作");
    expect(acceptance).toContain("服务接口可调用");
    expect(acceptance).toContain("设备实际已生效");
    expect(acceptance).toContain("PENDING");
    expect(script).toContain("http://127.0.0.1:8791");
    expect(script).toContain("http://127.0.0.1:8787");
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
    expect(printed.stdout).toContain("http://127.0.0.1:8787");
    expect(printed.stdout).toContain("/api/device-platform/v1/admin/connections/plat-local/test");
    expect(printed.stdout).toContain("/api/device-platform/v1/me/devices");
    expect(printed.stdout).toContain("/api/device-platform/v1/me/digital-humans/dh-a/devices");
    expect(printed.stdout).toContain('kind":"rebind');
    expect(printed.stdout).toContain('kind":"revoke');
    expect(printed.stdout).toContain("status revoked");
    expect(printed.stdout).not.toContain("harness-only-secret");

    const harness = await execFileAsync("bash", [path.join(here, "joint.sh")], {
      env: { ...process.env, OPENBOT_DEVICE_PLATFORM_JOINT: "harness" },
      timeout: 60_000,
    });
    expect(harness.stdout).toContain("harness ok");
    expect(harness.stdout).toContain("JOINT_PENDING cross-host hardware");
    expect(harness.stdout).toContain(OPENBOT_CONTRACT_SHA);
    expect(harness.stdout).toContain(DEVICE_SDK_MAIN_TIP);
    expect(harness.stdout).toContain(`CONTROL_FREEZE_SHA ${CONTROL_FREEZE_SHA}`);
    expect(harness.stdout).toContain("voice-photo stub deviceEffect false");
  }, 60_000);
});
