import { describe, expect, it } from "vitest";
import {
  resolveOpenBotSubdomainRedirectUrl,
  resolvePreferredOpenBotGatewayUrl,
  resolveRecoveredGatewayUrlForHostMismatch,
  shouldDiscardPublicHomeGatewayUrl,
} from "./openbot-subdomain-redirect.ts";

describe("resolveOpenBotSubdomainRedirectUrl", () => {
  it("redirects enterprise organization from openbot.love to biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "openbot.love",
      tab: "enterpriseOrganization",
      pathname: "/enterprise/organization",
      search: "?tenantId=acme",
      protocol: "https:",
    });
    expect(url).toBe("https://biz.openbot.love/enterprise/organization?tenantId=acme");
  });

  it("redirects enterprise organization from www to biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "www.openbot.love",
      tab: "enterpriseOrganization",
      pathname: "/enterprise/organization",
      search: "?tenantId=acme",
      protocol: "https:",
    });
    expect(url).toBe("https://biz.openbot.love/enterprise/organization?tenantId=acme");
  });

  it("redirects platform dashboard from openbot.love to admin", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "openbot.love",
      tab: "platformDashboard",
      pathname: "/platform",
      protocol: "https:",
    });
    expect(url).toBe("https://admin.openbot.love/platform");
  });

  it("redirects enterprise login from www to biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "www.openbot.love",
      tab: "enterpriseLogin",
      pathname: "/enterprise/login",
      search: "?authMode=enterprise-activate",
      protocol: "https:",
    });
    expect(url).toBe("https://biz.openbot.love/enterprise/login?authMode=enterprise-activate");
  });

  it("redirects enterprise login from admin to biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "admin.openbot.love",
      tab: "enterpriseLogin",
      pathname: "/enterprise/login",
      protocol: "https:",
    });
    expect(url).toBe("https://biz.openbot.love/enterprise/login");
  });

  it("redirects enterprise organization from admin to biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "admin.openbot.love",
      tab: "enterpriseOrganization",
      pathname: "/enterprise/organization",
      protocol: "https:",
    });
    expect(url).toBe("https://biz.openbot.love/enterprise/organization");
  });

  it("redirects platform login from the employee public hosts to admin", () => {
    for (const host of ["www.openbot.love", "openbot.love"]) {
      expect(
        resolveOpenBotSubdomainRedirectUrl({
          host,
          tab: "platformLogin",
          pathname: "/platform/login",
          protocol: "https:",
        }),
      ).toBe("https://admin.openbot.love/platform/login");
    }
  });

  it("redirects platform login from biz to admin", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "biz.openbot.love",
      tab: "platformLogin",
      pathname: "/platform/login",
      protocol: "https:",
    });
    expect(url).toBe("https://admin.openbot.love/platform/login");
  });

  it("redirects employee workbench from admin to www", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "admin.openbot.love",
      tab: "me",
      pathname: "/",
      search: "?session=agent%3Abot-skill%3Amain",
      protocol: "https:",
    });
    expect(url).toBe("https://www.openbot.love/?session=agent%3Abot-skill%3Amain");
  });

  it("redirects legacy gw employee host to www", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "gw.openbot.love",
      tab: "me",
      pathname: "/",
      search: "?session=main",
      protocol: "https:",
    });
    expect(url).toBe("https://www.openbot.love/?session=main");
  });

  it("redirects enterprise overview from gw to biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "gw.openbot.love",
      tab: "enterpriseOverview",
      pathname: "/enterprise",
      protocol: "https:",
    });
    expect(url).toBe("https://biz.openbot.love/enterprise");
  });

  it("keeps employee workbench on www", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "www.openbot.love",
      tab: "me",
      pathname: "/",
      protocol: "https:",
    });
    expect(url).toBeNull();
  });

  it("keeps marketing homepage on bare apex", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "openbot.love",
      tab: "me",
      pathname: "/",
      protocol: "https:",
    });
    expect(url).toBeNull();
  });

  it("does not redirect when already on biz", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "biz.openbot.love",
      tab: "enterpriseOrganization",
      pathname: "/enterprise/organization",
      protocol: "https:",
    });
    expect(url).toBeNull();
  });

  it("does not redirect platform tabs on admin", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "admin.openbot.love",
      tab: "platformModels",
      pathname: "/platform/models",
      protocol: "https:",
    });
    expect(url).toBeNull();
  });

  it("does not redirect local development hosts", () => {
    const url = resolveOpenBotSubdomainRedirectUrl({
      host: "localhost:5173",
      tab: "enterpriseOrganization",
      pathname: "/enterprise/organization",
      protocol: "http:",
    });
    expect(url).toBeNull();
  });
});

describe("shouldDiscardPublicHomeGatewayUrl", () => {
  it("drops a stale apex gateway URL when the page is on biz", () => {
    expect(
      shouldDiscardPublicHomeGatewayUrl({
        savedGatewayUrl: "wss://openbot.love",
        pageHost: "biz.openbot.love",
      }),
    ).toBe(true);
  });

  it("keeps a port-scoped gateway URL on the matching host", () => {
    expect(
      shouldDiscardPublicHomeGatewayUrl({
        savedGatewayUrl: "wss://biz.openbot.love",
        pageHost: "biz.openbot.love",
      }),
    ).toBe(false);
  });

  it("keeps saved settings on the employee host", () => {
    expect(
      shouldDiscardPublicHomeGatewayUrl({
        savedGatewayUrl: "wss://www.openbot.love",
        pageHost: "www.openbot.love",
      }),
    ).toBe(false);
  });
});

describe("resolvePreferredOpenBotGatewayUrl", () => {
  it("prefers the current biz host over a stale www gateway URL", () => {
    expect(
      resolvePreferredOpenBotGatewayUrl({
        gatewayUrl: "wss://www.openbot.love",
        pageHost: "biz.openbot.love",
        pageProtocol: "https:",
      }),
    ).toBe("wss://biz.openbot.love");
  });

  it("returns the saved URL when it already matches the page host", () => {
    expect(
      resolvePreferredOpenBotGatewayUrl({
        gatewayUrl: "wss://biz.openbot.love",
        pageHost: "biz.openbot.love",
        pageProtocol: "https:",
      }),
    ).toBe("wss://biz.openbot.love");
  });

  it("folds the legacy employee gw host onto www", () => {
    expect(
      resolvePreferredOpenBotGatewayUrl({
        gatewayUrl: "wss://gw.openbot.love",
        pageHost: "www.openbot.love",
        pageProtocol: "https:",
      }),
    ).toBe("wss://www.openbot.love");
  });
});

describe("resolveRecoveredGatewayUrlForHostMismatch", () => {
  it("recovers a stale www gateway URL while on biz", () => {
    expect(
      resolveRecoveredGatewayUrlForHostMismatch({
        currentGatewayUrl: "wss://www.openbot.love",
        pageUrl: "https://biz.openbot.love/enterprise/organization",
      }),
    ).toBe("wss://biz.openbot.love");
  });
});
