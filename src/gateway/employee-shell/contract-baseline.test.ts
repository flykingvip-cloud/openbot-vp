import { describe, expect, it } from "vitest";
import { getRequiredDomain } from "../platform-auth/session-domain.js";
import { listGatewayMethods } from "../server-methods-list.js";
import {
  EMPLOYEE_SHELL_DEFERRED_METHODS,
  EMPLOYEE_SHELL_V1_METHODS,
  EMPLOYEE_SHELL_WORKBENCH_V1_METHODS,
} from "./contract-baseline.js";

describe("employee-shell v1 contract freeze", () => {
  const registered = new Set(listGatewayMethods());

  it("keeps every frozen v1 method registered in the gateway", () => {
    const missing = EMPLOYEE_SHELL_V1_METHODS.filter((method) => !registered.has(method));
    expect(missing).toEqual([]);
  });

  it("keeps personal workbench methods employee-self-scoped (never global/any)", () => {
    const offenders = EMPLOYEE_SHELL_WORKBENCH_V1_METHODS.filter((method) => {
      const domain = getRequiredDomain(method);
      if (domain === "any") {
        return true;
      }
      return !(Array.isArray(domain) && domain.includes("employee"));
    });
    expect(offenders).toEqual([]);
  });

  it("does not accidentally freeze a method that is not registered", () => {
    // Guard against a typo in the frozen list silently passing: the frozen set
    // must be non-empty and fully covered by the registry.
    expect(EMPLOYEE_SHELL_V1_METHODS.length).toBeGreaterThan(0);
    expect(EMPLOYEE_SHELL_V1_METHODS.every((method) => registered.has(method))).toBe(true);
  });

  it("records deferred methods separately (not asserted as registered)", () => {
    // sessions.*/agents.* are documented as reusable in the design doc but are
    // not in listGatewayMethods(); keep them out of the freeze until confirmed.
    for (const method of EMPLOYEE_SHELL_DEFERRED_METHODS) {
      expect(EMPLOYEE_SHELL_V1_METHODS).not.toContain(method);
    }
  });
});
