import { describe, expect, it } from "vitest";
import {
  CONTROLLED_DATA_BRIDGE_UNLOCKED,
  evaluateControlledDataBridge,
} from "./controlled-data-bridge-guard.js";

const validA = {
  mode: "A",
  tenant_id: "syn_org",
  policy_generation: 3,
  freshness_ts: "2026-11-27T00:00:00Z",
  masking_receipt: { receipt_id: "syn_mask_1" },
  tombstone: { active: false },
  user_delegation_handle: "deleg:user_token_slot",
  query_kind: "object_get",
};

describe("ControlledDataBridgeGuard", () => {
  it("stays Fail-Closed and unlocked=false", () => {
    expect(CONTROLLED_DATA_BRIDGE_UNLOCKED).toBe(false);
    expect(evaluateControlledDataBridge(validA)).toEqual({
      allowed: false,
      code: "BRIDGE_LOCKED",
      mode: "A",
    });
  });

  it("rejects unmatched mode and text-to-sql even before lock", () => {
    expect(evaluateControlledDataBridge({ mode: "Z" })).toEqual({
      allowed: false,
      code: "MODE_UNMATCHED",
    });
    expect(evaluateControlledDataBridge({ ...validA, query_kind: "text_to_sql" })).toEqual({
      allowed: false,
      code: "TEXT_TO_SQL_FORBIDDEN",
    });
  });

  it("rejects incomplete Mode B/C declarations", () => {
    expect(
      evaluateControlledDataBridge({
        mode: "B",
        tenant_id: "syn_org",
        policy_generation: 1,
        freshness_ts: "2026-11-27T00:00:00Z",
        masking_receipt: {},
        tombstone: {},
      }),
    ).toEqual({ allowed: false, code: "VALIDATION_ERROR" });
    expect(
      evaluateControlledDataBridge({
        mode: "C",
        tenant_id: "syn_org",
        policy_generation: 1,
        freshness_ts: "2026-11-27T00:00:00Z",
        masking_receipt: {},
        tombstone: {},
      }),
    ).toEqual({ allowed: false, code: "VALIDATION_ERROR" });
  });
});
