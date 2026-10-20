import { describe, expect, it } from "vitest";
import {
  isOpenBotProductionHost,
  originForPort,
  resolvePortFromSubdomain,
  subdomainForPort,
} from "./subdomain-resolver.ts";

describe("resolvePortFromSubdomain", () => {
  it("maps www.openbot.love to employee port", () => {
    const result = resolvePortFromSubdomain("www.openbot.love");
    expect(result).toEqual({ port: "employee", isPublicHome: false, isOpenBotDomain: true });
  });

  it("maps gw.openbot.love to employee port (legacy alias)", () => {
    const result = resolvePortFromSubdomain("gw.openbot.love");
    expect(result).toEqual({ port: "employee", isPublicHome: false, isOpenBotDomain: true });
  });

  it("maps biz.openbot.love to enterprise port", () => {
    const result = resolvePortFromSubdomain("biz.openbot.love");
    expect(result).toEqual({ port: "enterprise", isPublicHome: false, isOpenBotDomain: true });
  });

  it("maps admin.openbot.love to platform port", () => {
    const result = resolvePortFromSubdomain("admin.openbot.love");
    expect(result).toEqual({ port: "platform", isPublicHome: false, isOpenBotDomain: true });
  });

  it("maps bare openbot.love to public home", () => {
    const result = resolvePortFromSubdomain("openbot.love");
    expect(result).toEqual({ port: null, isPublicHome: true, isOpenBotDomain: true });
  });

  it("does not treat www as public marketing home", () => {
    const result = resolvePortFromSubdomain("www.openbot.love");
    expect(result.isPublicHome).toBe(false);
    expect(result.port).toBe("employee");
  });

  it("returns null port for unknown subdomain", () => {
    const result = resolvePortFromSubdomain("unknown.openbot.love");
    expect(result).toEqual({ port: null, isPublicHome: false, isOpenBotDomain: true });
  });

  it("returns non-openbot for localhost", () => {
    const result = resolvePortFromSubdomain("localhost:18789");
    expect(result).toEqual({ port: null, isPublicHome: false, isOpenBotDomain: false });
  });

  it("returns non-openbot for arbitrary domains", () => {
    const result = resolvePortFromSubdomain("my-company.internal");
    expect(result).toEqual({ port: null, isPublicHome: false, isOpenBotDomain: false });
  });

  it("handles host with port number", () => {
    const result = resolvePortFromSubdomain("gw.openbot.love:443");
    expect(result).toEqual({ port: "employee", isPublicHome: false, isOpenBotDomain: true });
  });

  it("is case-insensitive", () => {
    const result = resolvePortFromSubdomain("GW.OpenBot.Love");
    expect(result).toEqual({ port: "employee", isPublicHome: false, isOpenBotDomain: true });
  });

  it("rejects multi-level subdomains", () => {
    const result = resolvePortFromSubdomain("a.gw.openbot.love");
    expect(result).toEqual({ port: null, isPublicHome: false, isOpenBotDomain: false });
  });

  it("trims whitespace", () => {
    const result = resolvePortFromSubdomain("  admin.openbot.love  ");
    expect(result).toEqual({ port: "platform", isPublicHome: false, isOpenBotDomain: true });
  });
});

describe("isOpenBotProductionHost", () => {
  it("returns true for all openbot subdomains", () => {
    expect(isOpenBotProductionHost("gw.openbot.love")).toBe(true);
    expect(isOpenBotProductionHost("biz.openbot.love")).toBe(true);
    expect(isOpenBotProductionHost("admin.openbot.love")).toBe(true);
    expect(isOpenBotProductionHost("www.openbot.love")).toBe(true);
    expect(isOpenBotProductionHost("openbot.love")).toBe(true);
  });

  it("returns false for non-openbot domains", () => {
    expect(isOpenBotProductionHost("localhost")).toBe(false);
    expect(isOpenBotProductionHost("example.com")).toBe(false);
  });
});

describe("subdomainForPort", () => {
  it("maps each port to correct subdomain prefix", () => {
    expect(subdomainForPort("employee")).toBe("www");
    expect(subdomainForPort("enterprise")).toBe("biz");
    expect(subdomainForPort("platform")).toBe("admin");
    expect(subdomainForPort("ops")).toBe("admin");
  });
});

describe("originForPort", () => {
  it("builds correct origin URLs", () => {
    expect(originForPort("employee")).toBe("https://www.openbot.love");
    expect(originForPort("enterprise")).toBe("https://biz.openbot.love");
    expect(originForPort("platform")).toBe("https://admin.openbot.love");
  });

  it("respects custom protocol", () => {
    expect(originForPort("employee", "http")).toBe("http://www.openbot.love");
  });
});
