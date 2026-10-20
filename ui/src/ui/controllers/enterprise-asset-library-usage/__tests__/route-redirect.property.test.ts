// @vitest-environment node
// Feature: enterprise-capability-usage-management → 已整合进「企业能力中心」
// Property 7: 路由重定向幂等（旧路径统一重定向到 /capabilities/*）

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
  it("resolveLegacyAgentsUrl redirects /agents/* into the capability center", () => {
    fc.assert(
      fc.property(
        tenantIdArb,
        fc.constantFrom("", "/", "/my-agents", "/team-agents", "/templates", "/foo/bar"),
        (tenantId, suffix) => {
          const legacy = `/enterprise/${tenantId}/agents${suffix}`;
          const resolved = resolveLegacyAgentsUrl(legacy);
          expect(resolved).toMatch(
            new RegExp(
              `^/enterprise/${tenantId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/capabilities`,
            ),
          );
          // Idempotent: applying twice yields same result
          expect(resolveLegacyAgentsUrl(resolved)).toBe(resolved);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveLegacyAgentsUrl maps /agents/templates to capabilities/install-management", () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const result = resolveLegacyAgentsUrl(`/enterprise/${tenantId}/agents/templates`);
        expect(result).toBe(`/enterprise/${tenantId}/capabilities/install-management`);
      }),
      { numRuns: 50 },
    );
  });

  it("resolveLegacyAgentsUrl maps /agents (and most subpaths) to capabilities/robots", () => {
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

  it("resolveLegacyAgentsUrl maps old usage-management sub-routes to capability center", () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        expect(resolveLegacyAgentsUrl(`/enterprise/${tenantId}/usage-management/robots`)).toBe(
          `/enterprise/${tenantId}/capabilities/robots`,
        );
        expect(resolveLegacyAgentsUrl(`/enterprise/${tenantId}/usage-management/analytics`)).toBe(
          `/enterprise/${tenantId}/capabilities/analytics`,
        );
        expect(resolveLegacyAgentsUrl(`/enterprise/${tenantId}/usage-management/governance`)).toBe(
          `/enterprise/${tenantId}/capabilities/governance`,
        );
        expect(resolveLegacyAgentsUrl(`/enterprise/${tenantId}/usage-management/installs`)).toBe(
          `/enterprise/${tenantId}/capabilities/install-management`,
        );
        expect(
          resolveLegacyAgentsUrl(`/enterprise/${tenantId}/usage-management/installs/cap-1`),
        ).toBe(`/enterprise/${tenantId}/capabilities/cap-1`);
      }),
      { numRuns: 50 },
    );
  });

  it("resolveLegacyInstallManagementUrl maps old installs path into capability center", () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const legacy = `/enterprise/${tenantId}/usage-management/installs`;
        const resolved = resolveLegacyInstallManagementUrl(legacy);
        expect(resolved).toBe(`/enterprise/${tenantId}/capabilities/install-management`);
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
          "/usage-management/analytics",
          "/usage-management/installs",
          "/capabilities",
          "/capabilities/robots",
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
      "/enterprise/acme/capabilities",
      "/enterprise/acme/capabilities/robots",
      "/enterprise/acme/organization",
      "/platform/agents",
    ];
    for (const url of cleanUrls) {
      expect(resolveLegacyAgentsUrl(url)).toBe(url);
    }
  });
});
