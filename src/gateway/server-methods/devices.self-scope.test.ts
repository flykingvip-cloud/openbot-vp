import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listDevicePairingMock = vi.fn();
const getPairedDeviceMock = vi.fn();
const rotateDeviceTokenMock = vi.fn();
const revokeDeviceTokenMock = vi.fn();
const updatePairedDeviceMetadataMock = vi.fn();
const requestDevicePairingMock = vi.fn();
const approveDevicePairingMock = vi.fn();
const removePairedDeviceMock = vi.fn();
const resolveTrustedAttributionMock = vi.fn();

vi.mock("../../infra/device-identity.js", () => ({
  normalizeDevicePublicKeyBase64Url: (value: string) => {
    const trimmed = value.trim();
    return trimmed || null;
  },
}));

vi.mock("../../infra/device-pairing.js", () => ({
  listDevicePairing: listDevicePairingMock,
  getPairedDevice: getPairedDeviceMock,
  rotateDeviceToken: rotateDeviceTokenMock,
  revokeDeviceToken: revokeDeviceTokenMock,
  updatePairedDeviceMetadata: updatePairedDeviceMetadataMock,
  requestDevicePairing: requestDevicePairingMock,
  approveDevicePairing: approveDevicePairingMock,
  rejectDevicePairing: vi.fn(),
  removePairedDevice: removePairedDeviceMock,
  summarizeDeviceTokens: (
    tokens: Record<string, { role: string; scopes?: string[] }> | undefined,
  ) =>
    Object.values(tokens ?? {}).map((entry) => ({
      role: entry.role,
      scopes: entry.scopes ?? [],
    })),
}));

vi.mock("../scope-attribution.js", () => ({
  resolveTrustedAttribution: resolveTrustedAttributionMock,
}));

function createRespondCapture() {
  const calls: Array<{
    ok: boolean;
    payload?: unknown;
    error?: { message?: string };
  }> = [];
  return {
    calls,
    respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      calls.push({ ok, payload, error });
    },
  };
}

function createContext() {
  return {
    logGateway: { info: vi.fn() },
    broadcast: vi.fn(),
  } as never;
}

describe("device server methods self scope", () => {
  beforeEach(() => {
    listDevicePairingMock.mockReset();
    getPairedDeviceMock.mockReset();
    rotateDeviceTokenMock.mockReset();
    revokeDeviceTokenMock.mockReset();
    updatePairedDeviceMetadataMock.mockReset();
    requestDevicePairingMock.mockReset();
    approveDevicePairingMock.mockReset();
    removePairedDeviceMock.mockReset();
    resolveTrustedAttributionMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("lists only the employee's own paired devices and hides pending requests", async () => {
    listDevicePairingMock.mockResolvedValue({
      pending: [{ requestId: "req-1", deviceId: "pending-1" }],
      paired: [
        { deviceId: "device-a", ownerId: "user-a", tokens: {} },
        { deviceId: "device-b", ownerId: "user-b", tokens: {} },
      ],
    });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-a" });

    const { deviceHandlers } = await import("./devices.js");
    const capture = createRespondCapture();
    await deviceHandlers["device.pair.list"]({
      params: {},
      respond: capture.respond,
      client: { sessionDomain: "employee" } as never,
      context: createContext(),
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    expect(capture.calls[0]?.payload).toMatchObject({
      pending: [],
      paired: [expect.objectContaining({ deviceId: "device-a", ownerId: "user-a" })],
    });
  });

  it("lazy-claims the current unowned device for the employee on list", async () => {
    const current = { deviceId: "device-current", tokens: {} };
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [current, { deviceId: "device-other", ownerId: "user-b", tokens: {} }],
    });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-a" });
    updatePairedDeviceMetadataMock.mockResolvedValue(undefined);

    const { deviceHandlers } = await import("./devices.js");
    const capture = createRespondCapture();
    await deviceHandlers["device.pair.list"]({
      params: {},
      respond: capture.respond,
      client: {
        sessionDomain: "employee",
        connect: { device: { id: "device-current" } },
      } as never,
      context: createContext(),
    } as never);

    expect(updatePairedDeviceMetadataMock).toHaveBeenCalledWith("device-current", {
      ownerId: "user-a",
    });
    expect(capture.calls[0]?.ok).toBe(true);
    expect(capture.calls[0]?.payload).toMatchObject({
      paired: [expect.objectContaining({ deviceId: "device-current", ownerId: "user-a" })],
    });
  });

  it("registers the current browser when trusted-proxy skipped pairing at connect", async () => {
    listDevicePairingMock.mockResolvedValueOnce({ pending: [], paired: [] }).mockResolvedValueOnce({
      pending: [],
      paired: [
        {
          deviceId: "browser-1",
          ownerId: "user-a",
          clientId: "openbot-control-ui",
          tokens: {},
        },
      ],
    });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-a" });
    requestDevicePairingMock.mockResolvedValue({
      status: "pending",
      created: true,
      request: { requestId: "req-browser", deviceId: "browser-1", silent: true },
    });
    approveDevicePairingMock.mockResolvedValue({
      requestId: "req-browser",
      device: { deviceId: "browser-1", ownerId: "user-a" },
    });

    const { deviceHandlers } = await import("./devices.js");
    const capture = createRespondCapture();
    await deviceHandlers["device.pair.list"]({
      params: {},
      respond: capture.respond,
      client: {
        sessionDomain: "employee",
        connect: {
          role: "operator",
          scopes: ["operator.admin"],
          client: {
            id: "openbot-control-ui",
            mode: "webchat",
            displayName: "Chrome · Mac",
            platform: "MacIntel",
            deviceFamily: "browser",
          },
          device: { id: "browser-1", publicKey: "pk-browser-1" },
        },
      } as never,
      context: createContext(),
    } as never);

    expect(requestDevicePairingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "browser-1",
        publicKey: "pk-browser-1",
        clientId: "openbot-control-ui",
        silent: true,
      }),
    );
    expect(approveDevicePairingMock).toHaveBeenCalledWith("req-browser", undefined, {
      ownerId: "user-a",
    });
    expect(capture.calls[0]?.ok).toBe(true);
    expect(capture.calls[0]?.payload).toMatchObject({
      paired: [expect.objectContaining({ deviceId: "browser-1", ownerId: "user-a" })],
    });
  });

  it("prunes duplicate browser sessions for the same employee fingerprint", async () => {
    listDevicePairingMock.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "browser-old",
          ownerId: "user-a",
          clientId: "openbot-control-ui",
          clientMode: "webchat",
          platform: "MacIntel",
          displayName: "Chrome · Mac",
          deviceFamily: "browser",
          approvedAtMs: 1000,
          createdAtMs: 1000,
          tokens: {},
        },
        {
          deviceId: "browser-current",
          ownerId: "user-a",
          clientId: "openbot-control-ui",
          clientMode: "webchat",
          platform: "MacIntel",
          displayName: "Chrome · Mac",
          deviceFamily: "browser",
          approvedAtMs: 2000,
          createdAtMs: 2000,
          tokens: {},
        },
        {
          deviceId: "mac-app",
          ownerId: "user-a",
          clientId: "openbot-macos",
          platform: "darwin",
          approvedAtMs: 3000,
          createdAtMs: 3000,
          tokens: {},
        },
      ],
    });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-a" });
    removePairedDeviceMock.mockResolvedValue(undefined);

    const { deviceHandlers } = await import("./devices.js");
    const capture = createRespondCapture();
    await deviceHandlers["device.pair.list"]({
      params: {},
      respond: capture.respond,
      client: {
        sessionDomain: "employee",
        connect: { device: { id: "browser-current" } },
      } as never,
      context: createContext(),
    } as never);

    expect(removePairedDeviceMock).not.toHaveBeenCalled();
    expect(capture.calls[0]?.ok).toBe(true);
    expect(capture.calls[0]?.payload).toMatchObject({
      paired: [
        expect.objectContaining({ deviceId: "browser-current" }),
        expect.objectContaining({ deviceId: "mac-app" }),
      ],
    });
  });

  it("rejects rotating another employee's device token", async () => {
    getPairedDeviceMock.mockResolvedValue({ deviceId: "device-b", ownerId: "user-b" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-a" });

    const { deviceHandlers } = await import("./devices.js");
    const capture = createRespondCapture();
    await deviceHandlers["device.token.rotate"]({
      params: { deviceId: "device-b", role: "desktop" },
      respond: capture.respond,
      client: { sessionDomain: "employee" } as never,
      context: createContext(),
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(capture.calls[0]?.error?.message).toContain("not authorized");
    expect(rotateDeviceTokenMock).not.toHaveBeenCalled();
  });

  it("rejects revoking another employee's device token", async () => {
    getPairedDeviceMock.mockResolvedValue({ deviceId: "device-b", ownerId: "user-b" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-a" });

    const { deviceHandlers } = await import("./devices.js");
    const capture = createRespondCapture();
    await deviceHandlers["device.token.revoke"]({
      params: { deviceId: "device-b", role: "desktop" },
      respond: capture.respond,
      client: { sessionDomain: "employee" } as never,
      context: createContext(),
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(capture.calls[0]?.error?.message).toContain("not authorized");
    expect(revokeDeviceTokenMock).not.toHaveBeenCalled();
  });
});
