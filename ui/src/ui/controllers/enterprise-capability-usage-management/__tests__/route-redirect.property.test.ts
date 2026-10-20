// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Property 7: 路由重定向幂等

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  resolveLegacyAgentsUrl,
  resolveLegacyInstallManagementUrl,
  resolveUrl,
} from "../route-redirect.ts";

const tenantIdArb = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => /^[a-z0-9-]+$/i.test(s));

describe("Property 7: route redirect idempotency", () => {
  it("resolveLegacyAgentsUrl is idempotent for /agents/* paths", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom("", "/", "/my-agents", "/team-agents", "/templates", "/foo/bar"),
        (tenantId, suffix) => {
          const legacy = `/enterprise/${tenantId}/agents${suffix}`;
          const resolved = resolveLegacyAgentsUrl(legacy);
          // Resolved path should be under /capabilities/*
          expect(resolved).toMatch(
            new RegExp(
              `^/enterprise/${tenantId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/capabilities/`,
            ),
          );
          // Idempotent: applying twice yields same result
          expect(resolveLegacyAgentsUrl(resolved)).toBe(resolved);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveLegacyAgentsUrl maps /agents/templates to /capabilities/install-management", () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const result = resolveLegacyAgentsUrl(`/enterprise/${tenantId}/agents/templates`);
        expect(result).toBe(`/enterprise/${tenantId}/capabilities/install-management`);
      }),
      { numRuns: 50 },
    );
  });

  it("resolveLegacyAgentsUrl maps /agents (and most subpaths) to /capabilities/robots", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom("", "/my-agents", "/team-agents", "/foo"),
        (tenantId, suffix) => {
          const result = resolveLegacyAgentsUrl(`/enterprise/${tenantId}/agents${suffix}`);
          expect(result).toBe(`/enterprise/${tenantId}/capabilities/robots`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveLegacyInstallManagementUrl maps install-management path to new module", () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const legacy = `/enterprise/${tenantId}/capabilities/install-management`;
        const resolved = resolveLegacyInstallManagementUrl(legacy);
        expect(resolved).toBe(legacy);
        // Idempotent
        expect(resolveLegacyInstallManagementUrl(resolved)).toBe(resolved);
      }),
      { numRuns: 50 },
    );
  });

  it("resolveUrl is idempotent (combined resolver)", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom(
          "",
          "/",
          "/agents",
          "/agents/my-agents",
          "/agents/templates",
          "/usage-management",
          "/usage-management/robots",
        ),
        (tenantId, suffix) => {
          const url = `/enterprise/${tenantId}${suffix}`;
          const once = resolveUrl(url);
          const twice = resolveUrl(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveLegacyAgentsUrl returns input unchanged for non-legacy paths", () => {
    const cleanUrls = [
      "/enterprise/acme/capabilities/robots",
      "/enterprise/acme/capabilities",
      "/enterprise/acme/organization",
      "/platform/agents",
    ];
    for (const url of cleanUrls) {
      expect(resolveLegacyAgentsUrl(url)).toBe(url);
    }
  });
});
