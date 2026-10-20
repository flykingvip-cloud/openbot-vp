import { describe, expect, it } from "vitest";
import {
  isEnterpriseAdminAuthenticated,
  isPlatformAdminAuthenticated,
  resolveActivePlatformAuthSession,
  shouldShowPlatformLoginEntry,
} from "./platform-auth-session.ts";

describe("platform auth session helpers", () => {
  it("prefers platformAuthState.session over bootstrap fallback", () => {
    const session = {
      provider: "trusted-proxy" as const,
      user: "admin@example.com",
    };
    expect(
      resolveActivePlatformAuthSession({
        platformAuthState: { enabled: true, hasUsers: true, session },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "other@example.com",
        },
      }),
    ).toEqual(session);
  });

  it("falls back to bootstrap session when platformAuthState.session is missing", () => {
    const bootstrapSession = {
      provider: "trusted-proxy" as const,
      user: "admin@example.com",
    };
    expect(
      resolveActivePlatformAuthSession({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          sessionKind: "platform-super-admin",
        },
        bootstrapAuthSession: bootstrapSession,
      }),
    ).toEqual(bootstrapSession);
  });

  it("treats platform admin session kinds as authenticated", () => {
    expect(
      isPlatformAdminAuthenticated({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          sessionKind: "platform-super-admin",
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "root@example.com",
        },
      }),
    ).toBe(true);
  });

  it("hides the login entry when platform auth is disabled", () => {
    expect(shouldShowPlatformLoginEntry({ platformAuthState: null })).toBe(false);
  });

  it("shows the login entry when platform auth is enabled but no admin session exists", () => {
    expect(
      shouldShowPlatformLoginEntry({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
        },
      }),
    ).toBe(true);
  });

  it("hides the login entry when a platform admin session exists", () => {
    expect(
      shouldShowPlatformLoginEntry({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          sessionKind: "platform-super-admin",
          session: {
            provider: "trusted-proxy",
            user: "admin@example.com",
          },
        },
      }),
    ).toBe(false);
  });

  it("treats only enterprise-admin session kinds as enterprise authenticated", () => {
    expect(
      isEnterpriseAdminAuthenticated({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          sessionKind: "enterprise-admin",
          session: {
            provider: "trusted-proxy",
            user: "admin@example.com",
          },
        },
      }),
    ).toBe(true);
  });

  it("does not treat member or bootstrap-only sessions as enterprise authenticated", () => {
    expect(
      isEnterpriseAdminAuthenticated({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
          sessionKind: "member",
          session: {
            provider: "trusted-proxy",
            user: "member@example.com",
          },
        },
      }),
    ).toBe(false);
    expect(
      isEnterpriseAdminAuthenticated({
        platformAuthState: {
          enabled: true,
          hasUsers: true,
        },
        bootstrapAuthSession: {
          provider: "trusted-proxy",
          user: "bootstrap@example.com",
        },
      }),
    ).toBe(false);
  });
});
