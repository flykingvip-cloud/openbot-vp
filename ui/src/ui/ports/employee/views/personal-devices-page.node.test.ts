// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import {
  parsePairingScan,
  renderPersonalDevicesPanel,
  resetPersonalDevicesPanelForTests,
  setPersonalDevicesClientForTests,
  type PersonalDeviceView,
  type PersonalDevicesClient,
} from "./personal-devices-page.ts";

const SECRET_URL = "https://platform.example/control";
const SECRET = "service-secret-value";

const device: PersonalDeviceView = {
  deviceId: "dev-1",
  displayName: "门口相机",
  platformId: "plat-1",
  externalDeviceId: "cam-1",
  model: "Lens-1",
  binding: {
    bindingId: "bind-1",
    digitalHumanId: "dh-a",
    scopes: ["chat"],
    status: "active",
    expectedBindingVersion: 1,
    appliedBindingVersion: 1,
    authorizationEstablished: true,
    platformApplied: true,
  },
  status: {
    online: false,
    presence: "unknown",
    capabilities: [],
  },
};

function client(): PersonalDevicesClient {
  return {
    listDevices: async () => [device],
    listPlatforms: async () => [{ platformId: "plat-1", displayName: "实验室设备" }],
    listHumans: async () => [{ digitalHumanId: "dh-a", displayName: "我的数字人" }],
    submit: async () => device,
  };
}

afterEach(() => {
  resetPersonalDevicesPanelForTests();
  setPersonalDevicesClientForTests(null);
  document.body.innerHTML = "";
});

describe("personal devices panel", () => {
  it("shows the member device and hides connector secrets", async () => {
    setPersonalDevicesClientForTests(client());
    resetPersonalDevicesPanelForTests();
    setPersonalDevicesClientForTests(client());
    const container = document.createElement("div");
    document.body.append(container);
    const paint = () => {
      render(html`${renderPersonalDevicesPanel()}`, container);
    };
    paint();
    await Promise.resolve();
    await Promise.resolve();
    paint();

    expect(container.textContent).toContain("设备与硬件");
    expect(container.textContent).toContain("门口相机");
    expect(container.textContent).toContain("Lens-1");
    expect(container.textContent).toContain("我的数字人");
    expect(container.textContent).toContain("对话");
    expect(container.textContent).toContain("已连接");
    expect(container.textContent).toContain("未知");
    expect(container.textContent).not.toContain(SECRET_URL);
    expect(container.textContent).not.toContain(SECRET);
    expect(container.querySelector("[data-testid=personal-device-add]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-revoke]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-transfer]")).not.toBeNull();
    expect(container.textContent).not.toContain("不会把设备直接改到别人名下");
    const transfer = container.querySelector<HTMLButtonElement>(
      "[data-testid=personal-device-transfer]",
    );
    transfer?.click();
    paint();
    expect(container.textContent).toContain("不会把设备直接改到别人名下");
  });

  it("reads a scanned pairing payload without keeping secrets", () => {
    expect(
      parsePairingScan(
        JSON.stringify({
          deviceId: "cam-1",
          pairChallenge: "pch_example01",
          pairingCode: "123456",
          serviceBaseUrl: SECRET_URL,
          clientSecret: SECRET,
        }),
      ),
    ).toEqual({ deviceId: "cam-1", challenge: "pch_example01", code: "123456" });
    expect(parsePairingScan("123456")).toEqual({ code: "123456" });
  });
});
