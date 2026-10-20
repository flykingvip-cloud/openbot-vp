import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSecureFormFillDeps,
  ensureSecureFormFillHostWired,
  resetSecureFormFillHostWiredForTests,
} from "./secure-form-fill-host.js";
import {
  getSecureFormFillDepsForTests,
  setSecureFormFillDepsForTests,
} from "./secure-form-fill.js";

const resolveCdpMock = vi.hoisted(() => vi.fn());
const getPageMock = vi.hoisted(() => vi.fn());
const typeViaMock = vi.hoisted(() => vi.fn());
const refLocatorMock = vi.hoisted(() => vi.fn());

vi.mock("./account-cdp-resolve.js", () => ({
  resolveAccountBrowserCdpUrl: (...args: unknown[]) => resolveCdpMock(...args),
}));

vi.mock("../../browser/pw-session.js", () => ({
  getPageForTargetId: (...args: unknown[]) => getPageMock(...args),
  refLocator: (...args: unknown[]) => refLocatorMock(...args),
}));

vi.mock("../../browser/pw-tools-core.interactions.js", () => ({
  typeViaPlaywright: (...args: unknown[]) => typeViaMock(...args),
}));

afterEach(() => {
  resolveCdpMock.mockReset();
  getPageMock.mockReset();
  typeViaMock.mockReset();
  refLocatorMock.mockReset();
  setSecureFormFillDepsForTests(null);
  resetSecureFormFillHostWiredForTests();
});

describe("secure-form-fill-host", () => {
  it("exports a deps factory that reads page hostname via mocked CDP", async () => {
    resolveCdpMock.mockResolvedValue("http://127.0.0.1:19222");
    getPageMock.mockResolvedValue({
      url: () => "https://login.example.com/signin",
      locator: vi.fn(),
    });
    const deps = createSecureFormFillDeps();
    const page = await deps.readPage({ tenantId: "t1", userId: "u1" });
    expect(page).toEqual({
      hostname: "login.example.com",
      href: "https://login.example.com/signin",
    });
    expect(resolveCdpMock).toHaveBeenCalledWith({ tenantId: "t1", userId: "u1" });
  });

  it("fills by ref then zeroizes values", async () => {
    resolveCdpMock.mockResolvedValue("http://127.0.0.1:19222");
    getPageMock.mockResolvedValue({
      url: () => "https://login.example.com/",
      locator: vi.fn(),
    });
    typeViaMock.mockResolvedValue(undefined);
    const deps = createSecureFormFillDeps();
    const values = { password: "s3cret" };
    const result = await deps.fillFields({
      tenantId: "t1",
      userId: "u1",
      fields: [{ fieldId: "password", ref: "e12" }],
      values,
    });
    expect(result.ok).toBe(true);
    expect(typeViaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpUrl: "http://127.0.0.1:19222",
        ref: "e12",
        text: "s3cret",
        slowly: false,
      }),
    );
    expect(values).toEqual({});
  });

  it("ensureSecureFormFillHostWired installs production deps once", () => {
    resolveCdpMock.mockResolvedValue(null);
    ensureSecureFormFillHostWired();
    const first = getSecureFormFillDepsForTests();
    ensureSecureFormFillHostWired();
    expect(getSecureFormFillDepsForTests()).toBe(first);
  });
});
