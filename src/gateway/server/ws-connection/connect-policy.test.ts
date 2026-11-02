import { describe, expect, test } from "vitest";
import {
  evaluateMissingDeviceIdentity,
  isFirstPartyNativeTrustedProxyAuth,
  isTrustedProxyControlUiOperatorAuth,
  resolveControlUiAuthPolicy,
  shouldAllowSilentLocalPairing,
  shouldSkipControlUiPairing,
} from "./connect-policy.js";

describe("ws connect policy", () => {
  test("resolves control-ui auth policy", () => {
    const bypass = resolveControlUiAuthPolicy({
      isControlUi: true,
      controlUiConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: {
        id: "dev-1",
        publicKey: "pk",
        signature: "sig",
        signedAt: Date.now(),
        nonce: "nonce-1",
      },
    });
    expect(bypass.allowBypass).toBe(true);
    expect(bypass.device).toBeNull();

    const regular = resolveControlUiAuthPolicy({
      isControlUi: false,
      controlUiConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: {
        id: "dev-2",
        publicKey: "pk",
        signature: "sig",
        signedAt: Date.now(),
        nonce: "nonce-2",
      },
    });
    expect(regular.allowBypass).toBe(false);
    expect(regular.device?.id).toBe("dev-2");
  });

  test("evaluates missing-device decisions", () => {
    const policy = resolveControlUiAuthPolicy({
      isControlUi: false,
      controlUiConfig: undefined,
      deviceRaw: null,
    });

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: true,
        role: "node",
        isControlUi: false,
        controlUiAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");

    const controlUiStrict = resolveControlUiAuthPolicy({
      isControlUi: true,
      controlUiConfig: { allowInsecureAuth: true, dangerouslyDisableDeviceAuth: false },
      deviceRaw: null,
    });
    // Remote Control UI with allowInsecureAuth -> still rejected.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isControlUi: true,
        controlUiAuthPolicy: controlUiStrict,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-control-ui-insecure-auth");

    // Local Control UI with allowInsecureAuth -> allowed.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isControlUi: true,
        controlUiAuthPolicy: controlUiStrict,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: true,
      }).kind,
    ).toBe("allow");

    // Control UI without allowInsecureAuth, even on localhost -> rejected.
    const controlUiNoInsecure = resolveControlUiAuthPolicy({
      isControlUi: true,
      controlUiConfig: { dangerouslyDisableDeviceAuth: false },
      deviceRaw: null,
    });
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isControlUi: true,
        controlUiAuthPolicy: controlUiNoInsecure,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: true,
      }).kind,
    ).toBe("reject-control-ui-insecure-auth");

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isControlUi: false,
        controlUiAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isControlUi: false,
        controlUiAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: false,
        authOk: false,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-unauthorized");

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "node",
        isControlUi: false,
        controlUiAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-device-required");

    // Trusted-proxy authenticated Control UI should bypass device-identity gating.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isControlUi: true,
        controlUiAuthPolicy: controlUiNoInsecure,
        trustedProxyAuthOk: true,
        sharedAuthOk: false,
        authOk: true,
        hasSharedAuth: false,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");
  });

  test("pairing registration skip is only for dangerouslyDisableDeviceAuth + shared auth", () => {
    const bypass = resolveControlUiAuthPolicy({
      isControlUi: true,
      controlUiConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: null,
    });
    const strict = resolveControlUiAuthPolicy({
      isControlUi: true,
      controlUiConfig: undefined,
      deviceRaw: null,
    });
    expect(shouldSkipControlUiPairing(bypass, true, false)).toBe(true);
    expect(shouldSkipControlUiPairing(bypass, false, false)).toBe(false);
    expect(shouldSkipControlUiPairing(strict, true, false)).toBe(false);
    // Trusted-proxy must still register the browser device for "我的设备".
    expect(shouldSkipControlUiPairing(strict, false, true)).toBe(false);
  });

  test("trusted-proxy control-ui bypass only applies to operator + trusted-proxy auth", () => {
    const cases: Array<{
      role: "operator" | "node";
      authMode: string;
      authOk: boolean;
      authMethod: string | undefined;
      expected: boolean;
    }> = [
      {
        role: "operator",
        authMode: "trusted-proxy",
        authOk: true,
        authMethod: "trusted-proxy",
        expected: true,
      },
      {
        role: "node",
        authMode: "trusted-proxy",
        authOk: true,
        authMethod: "trusted-proxy",
        expected: false,
      },
      {
        role: "operator",
        authMode: "token",
        authOk: true,
        authMethod: "trusted-proxy",
        expected: true,
      },
      {
        role: "operator",
        authMode: "token",
        authOk: true,
        authMethod: "token",
        expected: false,
      },
      {
        role: "operator",
        authMode: "trusted-proxy",
        authOk: false,
        authMethod: "trusted-proxy",
        expected: false,
      },
    ];

    for (const tc of cases) {
      expect(
        isTrustedProxyControlUiOperatorAuth({
          isControlUi: true,
          role: tc.role,
          authMode: tc.authMode,
          authOk: tc.authOk,
          authMethod: tc.authMethod,
        }),
      ).toBe(tc.expected);
    }
  });

  test("first-party native trusted-proxy auth matches android/ios/macos only", () => {
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openbot-android",
        authOk: true,
        authMethod: "trusted-proxy",
      }),
    ).toBe(true);
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openclaw-android",
        authOk: true,
        authMethod: "trusted-proxy",
      }),
    ).toBe(true);
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openbot-ios",
        authOk: true,
        authMethod: "trusted-proxy",
      }),
    ).toBe(true);
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openbot-macos",
        authOk: true,
        authMethod: "trusted-proxy",
      }),
    ).toBe(true);
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openbot-android",
        authOk: true,
        authMethod: "token",
      }),
    ).toBe(false);
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openbot-control-ui",
        authOk: true,
        authMethod: "trusted-proxy",
      }),
    ).toBe(false);
    expect(
      isFirstPartyNativeTrustedProxyAuth({
        clientId: "openbot-android",
        authOk: false,
        authMethod: "trusted-proxy",
      }),
    ).toBe(false);
  });

  test("silent pairing allows trusted-proxy native apps remotely", () => {
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "not-paired",
        trustedProxyAuthOk: false,
        firstPartyNativeTrustedProxyAuthOk: true,
      }),
    ).toBe(true);
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "scope-upgrade",
        firstPartyNativeTrustedProxyAuthOk: true,
      }),
    ).toBe(true);
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "role-upgrade",
        firstPartyNativeTrustedProxyAuthOk: true,
      }),
    ).toBe(false);
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: false,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "not-paired",
        firstPartyNativeTrustedProxyAuthOk: false,
      }),
    ).toBe(false);
    // Existing Control UI trusted-proxy path still works.
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: false,
        hasBrowserOriginHeader: true,
        isControlUi: true,
        isWebchat: false,
        reason: "not-paired",
        trustedProxyAuthOk: true,
      }),
    ).toBe(true);
    // Local CLI without browser origin still silent-approves.
    expect(
      shouldAllowSilentLocalPairing({
        isLocalClient: true,
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reason: "not-paired",
      }),
    ).toBe(true);
  });
});
