// @vitest-environment node
// P2 Task 2.3/2.6: session-domain guard coverage for user-operational-identity.* methods.
// Acceptance red line (expert review): no self-service user-operational-identity.*
// method may be left at the default "any"; the cross-user monitoring aggregator
// `governance.overview` is the sole intentional "any" (D5; authorized in-handler
// via resolveQueryScope).
//
// The assertions here are intentionally design-agnostic about HOW a self-service
// method is gated (a single `employee` domain, or a multi-domain self-scoped set
// such as [employee, enterprise, platform] so any authenticated user can manage
// their OWN identities). Both satisfy R8: the method is not left at "any". This
// keeps the test stable across the gating refinement landing in the ME group.

import { describe, expect, it } from "vitest";
import {
  getRequiredDomain,
  guardSessionDomain,
  listUnscopedDomainMethods,
} from "./platform-auth/session-domain.js";
import { listGatewayMethods } from "./server-methods-list.js";

const GOVERNANCE_OVERVIEW = "user-operational-identity.governance.overview";

const registeredSelfServiceMethods = listGatewayMethods().filter(
  (method) => method.startsWith("user-operational-identity.") && method !== GOVERNANCE_OVERVIEW,
);

describe("user-operational-identity session domain guard (Task 2.3)", () => {
  it("gates every self-service method (none left at the default any)", () => {
    expect(registeredSelfServiceMethods.length).toBeGreaterThan(0);
    for (const method of registeredSelfServiceMethods) {
      expect(getRequiredDomain(method)).not.toBe("any");
    }
    expect(listUnscopedDomainMethods(registeredSelfServiceMethods)).toEqual([]);
  });

  it("admits self-service methods from an employee session", () => {
    for (const method of registeredSelfServiceMethods) {
      expect(guardSessionDomain(method, "employee").allowed).toBe(true);
    }
  });

  it("keeps governance.overview at the default any (D5, in-handler scope enforcement)", () => {
    expect(getRequiredDomain(GOVERNANCE_OVERVIEW)).toBe("any");
  });

  it("admits governance.overview from platform and enterprise sessions (D5 cross-domain)", () => {
    // The single-valued match cannot express platform∪enterprise on its own, so
    // governance.overview stays "any": none of platform/enterprise/employee are
    // blocked at the entrypoint; scope isolation is enforced in-handler via
    // resolveQueryScope.
    for (const domain of ["platform", "enterprise", "employee"] as const) {
      expect(guardSessionDomain(GOVERNANCE_OVERVIEW, domain).allowed).toBe(true);
    }
  });
});
