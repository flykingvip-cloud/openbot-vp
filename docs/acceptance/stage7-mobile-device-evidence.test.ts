/**
 * Stage 7 mobile/device surfaces (ios, android, harmony, macos).
 *
 * Box has no device pool / Xcode / JDK for these surfaces. This file records
 * honest NOT_RUN probes + E1 client-id anchors. It must NOT flip surface
 * acceptance_status to PASS (§5.7: no device ⇒ NOT_RUN, not PASS;
 * existence/config-only ⇒ FAIL for the surface).
 *
 * stage8_eligible stays false. Stage 7 overall is not PASS.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_CLIENT_IDS,
  LEGACY_GATEWAY_CLIENT_ID_ALIASES,
  normalizeGatewayClientId,
} from "../../src/gateway/protocol/client-info.js";

const ROOT = process.cwd();

function commandExists(bin: string): boolean {
  try {
    execFileSync("bash", ["-lc", `command -v ${bin}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function probeDeviceTooling() {
  return {
    platform: process.platform,
    hasXcodebuild: commandExists("xcodebuild"),
    hasXcrun: commandExists("xcrun"),
    hasJava: commandExists("java"),
    hasAdb: commandExists("adb"),
    hasOhpm: commandExists("ohpm"),
    hasHvigorw: commandExists("hvigorw") || fs.existsSync(path.join(ROOT, "apps/harmony/hvigor")),
    iosTree: fs.existsSync(path.join(ROOT, "apps/ios")),
    androidTree: fs.existsSync(path.join(ROOT, "apps/android")),
    macosTree: fs.existsSync(path.join(ROOT, "apps/macos")),
    harmonyTree: fs.existsSync(path.join(ROOT, "apps/harmony")),
  };
}

describe("Stage 7 mobile device environment (NOT_RUN, not PASS)", () => {
  it("records box tooling blockers: no Xcode/JDK/adb/ohpm for device E3", () => {
    const probe = probeDeviceTooling();
    // Linux acceptance box: expect missing Apple/Android device toolchains.
    expect(probe.platform).toBe("linux");
    expect(probe.hasXcodebuild).toBe(false);
    expect(probe.hasXcrun).toBe(false);
    expect(probe.hasJava).toBe(false);
    expect(probe.hasAdb).toBe(false);
    expect(probe.hasOhpm).toBe(false);
    // Trees exist (existence alone is NOT surface PASS per §5.7).
    expect(probe.iosTree).toBe(true);
    expect(probe.androidTree).toBe(true);
    expect(probe.macosTree).toBe(true);
    expect(probe.harmonyTree).toBe(true);
  });
});

describe("Stage 7 mobile E1 client-id anchors (not device PASS)", () => {
  it("canonical ios/android/macos client ids normalize; harmony has no GATEWAY_CLIENT_IDS entry", () => {
    expect(GATEWAY_CLIENT_IDS.IOS_APP).toBe("openbot-ios");
    expect(GATEWAY_CLIENT_IDS.ANDROID_APP).toBe("openbot-android");
    expect(GATEWAY_CLIENT_IDS.MACOS_APP).toBe("openbot-macos");
    expect(normalizeGatewayClientId("openbot-ios")).toBe("openbot-ios");
    expect(normalizeGatewayClientId("openclaw-ios")).toBe("openbot-ios");
    expect(normalizeGatewayClientId("openclaw-android")).toBe("openbot-android");
    expect(normalizeGatewayClientId("openclaw-macos")).toBe("openbot-macos");
    expect(LEGACY_GATEWAY_CLIENT_ID_ALIASES["openclaw-ios"]).toBe(GATEWAY_CLIENT_IDS.IOS_APP);

    // Honest gap: no openbot-harmony / openclaw-harmony in protocol client-info.
    const values = Object.values(GATEWAY_CLIENT_IDS) as string[];
    expect(values.some((v) => /harmony/i.test(v))).toBe(false);
    expect(normalizeGatewayClientId("openbot-harmony")).toBeUndefined();
    expect(normalizeGatewayClientId("openclaw-harmony")).toBeUndefined();
  });
});

describe("Stage 7 mobile path_kind skip contract (documentation probe)", () => {
  it("declares required path_kinds remain NOT_RUN without approved device + gateway round-trip", () => {
    const surfaces = ["ios", "android", "harmony", "macos"] as const;
    const pathKinds = ["happy_path", "negative_path", "observable_result"] as const;
    const blockers = {
      ios: "no iOS device/simulator pool; no xcodebuild on linux acceptance box",
      android: "no Android device/emulator pool; no JDK/adb on acceptance box",
      harmony: "no Harmony device/pool; no ohpm; no GATEWAY_CLIENT_IDS harmony entry",
      macos: "no macOS app host on linux box; protocol:check ≠ device round-trip",
    } as const;
    const flipToPass = {
      ios: "approved device connects; client id accepted; one node invoke round-trip + unapproved-device denial (E3)",
      android:
        "approved device connects; client id accepted; one node invoke round-trip + unapproved-device denial (E3)",
      harmony:
        "add/accept harmony client id if required; approved device connect + node invoke + denial (E3)",
      macos:
        "approved macOS app connects; client id accepted; one node invoke round-trip + denial (E3)",
    } as const;

    for (const surface of surfaces) {
      for (const pathKind of pathKinds) {
        // Explicit contract for the ledger: each path stays NOT_RUN here.
        expect({
          surface_id: surface,
          path_kind: pathKind,
          acceptance_for_path: "NOT_RUN",
          blocker: blockers[surface],
          owner: "platform/mobile",
          flip_to_pass: flipToPass[surface],
          surface_acceptance_status: "FAIL",
        }).toMatchObject({
          acceptance_for_path: "NOT_RUN",
          surface_acceptance_status: "FAIL",
        });
      }
    }
  });
});
