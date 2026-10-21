// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersonalDevicesFetchClient,
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

  it("preselects the current digital human and still submits that id", async () => {
    const submitted: Array<Record<string, unknown>> = [];
    setPersonalDevicesClientForTests({
      listDevices: async (query) =>
        query?.digitalHumanId === "dh-a" ? [device] : [device, otherDevice()],
      listPlatforms: async () => [{ platformId: "plat-1", displayName: "实验室设备" }],
      listHumans: async () => [
        { digitalHumanId: "dh-other", displayName: "其他数字人" },
        { digitalHumanId: "dh-a", displayName: "我的数字人" },
      ],
      submit: async (body) => {
        submitted.push(body);
        return device;
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const paint = () => {
      render(
        html`${renderPersonalDevicesPanel({
          digitalHumanId: "dh-a",
          digitalHumanName: "我的数字人",
          title: "已连接设备",
          surface: "detail",
        })}`,
        container,
      );
    };
    await flush(paint);

    expect(container.textContent).toContain("已连接设备");
    expect(container.textContent).toContain("门口相机");
    expect(container.textContent).not.toContain("设备与硬件");
    expect(container.textContent).not.toContain(SECRET_URL);
    const human = container.querySelector<HTMLInputElement>("[data-testid=personal-device-human]");
    expect(human?.disabled).toBe(true);
    expect(human?.getAttribute("data-digital-human-id")).toBe("dh-a");
    expect(human?.value).toBe("我的数字人");

    setField(container, "[data-testid=personal-device-id]", "cam-9");
    setField(container, "[data-testid=personal-device-challenge]", "pch_example");
    setField(container, "[data-testid=personal-device-code]", "123456");
    container
      .querySelector("[data-testid=personal-device-add]")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush(paint);

    expect(submitted[0]).toMatchObject({
      kind: "add",
      digitalHumanId: "dh-a",
      externalDeviceId: "cam-9",
      pairing: { challenge: "pch_example", proof: "123456" },
    });
    expect(JSON.stringify(submitted[0])).not.toContain("pairChallenge");
    expect(JSON.stringify(submitted[0])).not.toContain("pairingCode");
  });

  it("shows the same store from settings and the digital-human detail", async () => {
    const store = [cloneDevice(device), otherDevice()];
    setPersonalDevicesClientForTests(sharedClient(store));
    const container = document.createElement("div");
    document.body.append(container);
    const paint = (digitalHumanId?: string) => {
      render(
        html`${renderPersonalDevicesPanel(
          digitalHumanId
            ? {
                digitalHumanId,
                digitalHumanName: "我的数字人",
                title: "已连接设备",
                surface: "detail",
              }
            : undefined,
        )}`,
        container,
      );
    };
    await flush(() => paint());
    expect(container.textContent).toContain("门口相机");
    expect(container.textContent).toContain("会议室屏幕");

    await flush(() => paint("dh-a"));
    expect(container.textContent).toContain("门口相机");
    expect(container.textContent).not.toContain("会议室屏幕");

    container.querySelector<HTMLButtonElement>("[data-testid=personal-device-revoke]")?.click();
    paint("dh-a");
    clickText(container, "确认解除");
    await flush(() => paint("dh-a"));
    expect(container.textContent).not.toContain("门口相机");

    await flush(() => paint());
    expect(container.textContent).toContain("门口相机");
    expect(container.textContent).toContain("未绑定");
    expect(container.textContent).toContain("会议室屏幕");
    expect(container.textContent).toContain("已连接");
  });

  it("keeps device effect unconfirmed when authorization and platform are already true", async () => {
    const row = cloneDevice(device);
    if (row.binding) {
      row.binding.authorizationEstablished = true;
      row.binding.platformApplied = true;
      row.binding.deviceEffect = false;
      row.binding.status = "active";
    }
    setPersonalDevicesClientForTests({
      ...client(),
      listDevices: async () => [row],
    });
    const container = document.createElement("div");
    document.body.append(container);
    await flush(() => {
      render(html`${renderPersonalDevicesPanel()}`, container);
    });

    expect(effectText(container, "personal-device-effect-auth")).toBe("已授权");
    expect(effectText(container, "personal-device-effect-platform")).toBe("平台已接受");
    expect(effectText(container, "personal-device-effect-device")).toBe("未确认·JOINT_PENDING");
    expect(container.textContent).toContain("未确认·JOINT_PENDING");
    expect(container.textContent).toContain("已连接");
    expect(effectText(container, "personal-device-effect-device")).not.toBe("设备已应用");
  });

  it("shows the same unconfirmed effect on an empty list and while the platform is applying", async () => {
    setPersonalDevicesClientForTests({
      ...client(),
      listDevices: async () => [],
    });
    const container = document.createElement("div");
    document.body.append(container);
    await flush(() => {
      render(
        html`${renderPersonalDevicesPanel({ title: "已连接设备", surface: "detail" })}`,
        container,
      );
    });
    expect(container.textContent).toContain("已连接设备");
    expect(effectText(container, "personal-device-effect-auth")).toBe("未授权");
    expect(effectText(container, "personal-device-effect-platform")).toBe("未接受");
    expect(effectText(container, "personal-device-effect-device")).toBe("未确认·JOINT_PENDING");

    const applying = cloneDevice(device);
    if (applying.binding) {
      applying.binding.authorizationEstablished = true;
      applying.binding.platformApplied = false;
      applying.binding.status = "applying";
      delete applying.binding.deviceEffect;
    }
    resetPersonalDevicesPanelForTests();
    setPersonalDevicesClientForTests({
      ...client(),
      listDevices: async () => [applying],
    });
    await flush(() => {
      render(html`${renderPersonalDevicesPanel()}`, container);
    });
    expect(effectText(container, "personal-device-effect-platform")).toBe("应用中");
    expect(effectText(container, "personal-device-effect-device")).toBe("未确认·JOINT_PENDING");
  });

  it("asks the digital-human route for that human only", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(requestUrl(input));
      return new Response(
        JSON.stringify({ ok: true, devices: [], platforms: [], digitalHumans: [] }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;
    const api = createPersonalDevicesFetchClient(fetchImpl);
    await api.listDevices({ digitalHumanId: "dh a/1" });
    await api.listDevices();
    expect(urls[0]).toBe("/api/device-platform/v1/me/digital-humans/dh%20a%2F1/devices");
    expect(urls[1]).toBe("/api/device-platform/v1/me/devices");
  });
});

function cloneDevice(item: PersonalDeviceView): PersonalDeviceView {
  return {
    ...item,
    binding: item.binding ? { ...item.binding, scopes: [...item.binding.scopes] } : null,
    status: { ...item.status, capabilities: [...item.status.capabilities] },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function otherDevice(): PersonalDeviceView {
  return {
    ...device,
    deviceId: "dev-2",
    displayName: "会议室屏幕",
    externalDeviceId: "screen-1",
    binding: device.binding
      ? { ...device.binding, bindingId: "bind-2", digitalHumanId: "dh-b" }
      : null,
  };
}

function sharedClient(store: PersonalDeviceView[]): PersonalDevicesClient {
  return {
    listDevices: async (query) =>
      store
        .filter((item) =>
          query?.digitalHumanId ? item.binding?.digitalHumanId === query.digitalHumanId : true,
        )
        .map((item) => ({
          ...item,
          binding: item.binding ? { ...item.binding } : null,
          status: { ...item.status, capabilities: [...item.status.capabilities] },
        })),
    listPlatforms: async () => [{ platformId: "plat-1", displayName: "实验室设备" }],
    listHumans: async () => [
      { digitalHumanId: "dh-a", displayName: "我的数字人" },
      { digitalHumanId: "dh-b", displayName: "另一位数字人" },
    ],
    submit: async (body) => {
      const row = store.find((item) => item.deviceId === body.deviceId);
      if (body.kind === "revoke" && row) {
        row.binding = null;
      }
      return row
        ? {
            ...row,
            binding: row.binding ? { ...row.binding } : null,
            status: { ...row.status, capabilities: [...row.status.capabilities] },
          }
        : null;
    },
  };
}

async function flush(paint: () => void): Promise<void> {
  paint();
  for (let step = 0; step < 6; step += 1) {
    await Promise.resolve();
  }
  paint();
}

function setField(container: ParentNode, selector: string, value: string): void {
  const field = container.querySelector<HTMLInputElement>(selector);
  if (!field) {
    throw new Error(`missing ${selector}`);
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function effectText(container: ParentNode, testId: string): string {
  return container.querySelector(`[data-testid=${testId}]`)?.textContent ?? "";
}

function clickText(container: ParentNode, text: string): void {
  Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text)
    ?.click();
}
