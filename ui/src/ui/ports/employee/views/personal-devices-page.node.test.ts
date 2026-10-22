// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersonalDevicesFetchClient,
  parsePairingScan,
  PersonalDevicesRequestError,
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
    expect(container.textContent).toContain("未确认·JOINT_PENDING");
    expect(container.textContent).not.toContain("设备已应用");
    expect(container.textContent).not.toContain(SECRET_URL);
    expect(container.textContent).not.toContain(SECRET);
    expect(viewName(container)).toBe("list");
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();
    expect(container.querySelector("[data-testid=personal-devices-add]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-revoke]")).toBeNull();

    container.querySelector<HTMLButtonElement>("[data-testid=personal-device-row]")?.click();
    paint();
    expect(viewName(container)).toBe("detail");
    expect(container.textContent).toContain("未知");
    expect(container.querySelector("[data-testid=personal-device-revoke]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-transfer]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();
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
    expect(viewName(container)).toBe("list");
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();
    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-add]")?.click();
    paint();
    expect(viewName(container)).toBe("add");
    const human = container.querySelector<HTMLInputElement>("[data-testid=personal-device-human]");
    expect(human?.disabled).toBe(true);
    expect(human?.getAttribute("data-digital-human-id")).toBe("dh-a");
    expect(human?.value).toBe("我的数字人");

    expect(container.querySelector("[data-testid=personal-device-pair-details]")).toBeNull();
    pasteScan(
      container,
      JSON.stringify({
        deviceId: "cam-9",
        pairChallenge: "pch_example",
        pairingCode: "123456",
      }),
    );
    paint();
    expect(container.querySelector("[data-testid=personal-device-pair-details]")).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>("[data-testid=personal-device-id]")?.value,
    ).toBe("cam-9");
    expect(
      container.querySelector<HTMLInputElement>("[data-testid=personal-device-challenge]")?.value,
    ).toBe("pch_example");
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
    expect(viewName(container)).toBe("list");

    container.querySelector<HTMLButtonElement>("[data-testid=personal-device-row]")?.click();
    paint("dh-a");
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

  it("opens add from an empty list and shows effect only on a real row", async () => {
    setPersonalDevicesClientForTests({
      ...client(),
      listDevices: async () => [],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const paintEmpty = () => {
      render(
        html`${renderPersonalDevicesPanel({ title: "已连接设备", surface: "detail" })}`,
        container,
      );
    };
    await flush(paintEmpty);
    expect(container.textContent).toContain("已连接设备");
    expect(viewName(container)).toBe("empty");
    expect(container.textContent).toContain("还没有设备");
    expect(container.querySelector("[data-testid=personal-devices-add]")?.textContent).toContain(
      "添加设备",
    );
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();
    expect(container.querySelector("[data-testid=personal-device-effect-device]")).toBeNull();
    expect(container.textContent).not.toContain("设备请求失败");

    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-add]")?.click();
    paintEmpty();
    expect(viewName(container)).toBe("add");
    expect(container.querySelector("[data-testid=personal-device-add]")).not.toBeNull();
    expect(container.querySelector(".personal-devices__pair")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-scan]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-pair-details]")).toBeNull();
    expect(container.querySelector("[data-testid=personal-device-scopes]")).not.toBeNull();
    expect(container.querySelector("[data-testid=personal-device-submit]")?.textContent).toContain(
      "添加并授权",
    );
    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-back]")?.click();
    paintEmpty();
    expect(viewName(container)).toBe("empty");
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();

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

  it("keeps a load failure in a callout and still opens add", async () => {
    let fail = true;
    setPersonalDevicesClientForTests({
      ...client(),
      listDevices: async () => {
        if (fail) {
          throw new PersonalDevicesRequestError(401, "UNAUTHENTICATED", "请先登录。");
        }
        return [device];
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const paint = () => {
      render(html`${renderPersonalDevicesPanel()}`, container);
    };
    await flush(paint);

    expect(viewName(container)).toBe("error");
    const callout = container.querySelector("[data-testid=personal-devices-status]");
    expect(callout?.classList.contains("callout")).toBe(true);
    expect(callout?.classList.contains("danger")).toBe(true);
    expect(callout?.textContent).toContain("登录已失效");
    expect(callout?.textContent).not.toContain("设备请求失败。");
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();
    const retry = container.querySelector("[data-testid=personal-devices-retry]");
    const addOnError = container.querySelector("[data-testid=personal-devices-add]");
    expect(retry).not.toBeNull();
    expect(retry?.classList.contains("btn--primary")).toBe(true);
    expect(addOnError?.classList.contains("btn--primary")).toBe(false);

    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-add]")?.click();
    paint();
    expect(viewName(container)).toBe("add");
    expect(container.querySelector("[data-testid=personal-devices-status]")).toBeNull();
    expect(container.querySelector("[data-testid=personal-device-add]")).not.toBeNull();
    expect(container.querySelector(".personal-devices__form")).not.toBeNull();

    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-back]")?.click();
    paint();
    expect(viewName(container)).toBe("error");

    fail = false;
    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-retry]")?.click();
    await flush(paint);
    expect(viewName(container)).toBe("list");
    expect(container.textContent).toContain("门口相机");
    expect(effectText(container, "personal-device-effect-device")).toBe("未确认·JOINT_PENDING");
  });

  it("shows a submit failure as a callout on the add form", async () => {
    setPersonalDevicesClientForTests({
      ...client(),
      listDevices: async () => [],
      submit: async () => {
        throw new Error("设备请求失败。");
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const paint = () => {
      render(
        html`${renderPersonalDevicesPanel({ surface: "detail", title: "已连接设备" })}`,
        container,
      );
    };
    await flush(paint);
    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-add]")?.click();
    paint();
    pasteScan(
      container,
      JSON.stringify({
        deviceId: "cam-9",
        pairChallenge: "pch_example",
        pairingCode: "123456",
      }),
    );
    paint();
    container
      .querySelector("[data-testid=personal-device-add]")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush(paint);

    expect(viewName(container)).toBe("add");
    const notice = container.querySelector("[data-testid=personal-devices-notice]");
    expect(notice?.classList.contains("callout")).toBe(true);
    expect(notice?.classList.contains("danger")).toBe(true);
    expect(notice?.textContent).toContain("设备请求失败。");
    expect(container.querySelector("p.personal-devices__note")).toBeNull();
    expect(container.querySelector("[data-testid=personal-device-add]")).not.toBeNull();
    expect(container.textContent).not.toContain("设备已应用");
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

function pasteScan(container: ParentNode, value: string): void {
  const field = container.querySelector<HTMLTextAreaElement>("[data-testid=personal-device-scan]");
  if (!field) {
    throw new Error("missing personal-device-scan");
  }
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function effectText(container: ParentNode, testId: string): string {
  return container.querySelector(`[data-testid=${testId}]`)?.textContent ?? "";
}

function viewName(container: ParentNode): string | null {
  return (
    container
      .querySelector("[data-personal-devices-view]")
      ?.getAttribute("data-personal-devices-view") ?? null
  );
}

function clickText(container: ParentNode, text: string): void {
  Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text)
    ?.click();
}
