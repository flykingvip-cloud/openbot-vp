import { describe, expect, it } from "vitest";
import { PROGRESS_LEDGER_ENABLED_ENV, isProgressLedgerEnabled } from "./feature.js";

describe("isProgressLedgerEnabled", () => {
  const off = () => false;

  it("is off by default", () => {
    expect(isProgressLedgerEnabled({}, off)).toBe(false);
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "0" }, off)).toBe(false);
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "" }, off)).toBe(false);
  });

  it("is on for 1/true/yes/on", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: value }, off)).toBe(true);
    }
  });

  it("config OR env enables", () => {
    expect(isProgressLedgerEnabled({}, () => true)).toBe(true);
    expect(isProgressLedgerEnabled({ [PROGRESS_LEDGER_ENABLED_ENV]: "1" }, off)).toBe(true);
  });
});
