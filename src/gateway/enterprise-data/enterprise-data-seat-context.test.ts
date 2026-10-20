import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  assertNoClientExecutionIdentity,
  assertTrustedExecutionContext,
  createTrustedExecutionContextForTest,
  listForbiddenClientExecutionFields,
} from "./enterprise-data-seat-context.js";

describe("enterprise-data seat context trust boundary", () => {
  it("lists forbidden client execution identity fields", () => {
    expect(
      listForbiddenClientExecutionFields({
        seatId: "seat-a",
        connectorId: "crm",
      }),
    ).toEqual(["seatId"]);
  });

  it("rejects client-supplied seatId and employeeId for execution RPC params", () => {
    expect(() =>
      assertNoClientExecutionIdentity({
        seatId: "seat-attacker",
        employeeId: "emp-attacker",
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      }),
    ).toThrowError(EnterpriseDataStoreError);
    try {
      assertNoClientExecutionIdentity({
        teamLabel: "伪造团队",
        departmentId: "dept-x",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("UNTRUSTED_CLIENT_CONTEXT");
    }
  });

  it("rejects operational identity elevation on enterprise-data invoke params", () => {
    expect(() =>
      assertNoClientExecutionIdentity({
        connectorId: "crm",
        identityId: "identity-attacker",
      }),
    ).toThrowError(EnterpriseDataStoreError);
  });

  it("rejects invoke context without server trust attestation", () => {
    expect(() =>
      assertTrustedExecutionContext({
        tenantId: "tenant-a",
        seatId: "seat-a",
        employeeId: "emp-a",
        userId: "emp-a",
      }),
    ).toThrowError(EnterpriseDataStoreError);
  });

  it("accepts server-attested execution context for gateway unit tests", () => {
    const context = createTrustedExecutionContextForTest({
      tenantId: "tenant-a",
      seatId: "seat-a",
      employeeId: "emp-a",
      userId: "emp-a",
      teamLabel: "华东销售",
    });
    expect(() => assertTrustedExecutionContext(context)).not.toThrow();
    expect(context.trustAttestation).toBe("server-session-v1");
  });
});
