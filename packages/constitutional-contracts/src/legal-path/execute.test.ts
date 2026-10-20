import { describe, expect, it } from "vitest";
import {
  CONSTITUTIONAL_DECLARED_PATH_V1,
  LEGAL_PATH_EXECUTE_ENV,
  LEGAL_PATH_SELECT_ENV,
  PACKAGE_LOCAL_EXECUTE_ALLOWED,
  PHASE_D_P8B_EXECUTE_OPT_IN_SCOPE,
  PHASE_D_P8B_KNIFE1_SCOPE,
  executeLegalPath,
  isLegalPathExecuteEnabled,
  sampleLegalPathSelectInput,
  selectLegalPath,
} from "../index.js";

describe("P8b execute opt-in (phase_d_p8b_execute_opt_in)", () => {
  it("stays inert with both flags default-off — executed false", () => {
    const input = structuredClone(sampleLegalPathSelectInput);
    const before = JSON.stringify(input);
    const result = executeLegalPath(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.scope).toBe(PHASE_D_P8B_EXECUTE_OPT_IN_SCOPE);
    expect(result.selectScope).toBe(PHASE_D_P8B_KNIFE1_SCOPE);
    expect(result.mode).toBe("inert");
    expect(result.select.selectEnabled).toBe(false);
    expect(result.executeEnabled).toBe(false);
    expect(result.selectedPath).toBeNull();
    expect(result.executed).toBe(false);
    expect(result.sideEffects).toEqual([]);
    expect(result.c5Pass).toBe(false);
    expect(result.readyToTighten).toBe(false);
    expect(result.shadowCompared).toBe(false);
    expect(result.enforce).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.mutated).toBe(false);
  });

  it("SELECT only (selected) → executed false", () => {
    const input = {
      ...structuredClone(sampleLegalPathSelectInput),
      candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
    };
    const result = executeLegalPath(input, { select: true });
    expect(result.mode).toBe("select_only");
    expect(result.select.selectEnabled).toBe(true);
    expect(result.select.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.executeEnabled).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.sideEffects).toEqual([]);
    expect(result.c5Pass).toBe(false);
    expect(result.readyToTighten).toBe(false);
  });

  it("SELECT∧EXECUTE + valid candidate → executed true", () => {
    const input = {
      ...structuredClone(sampleLegalPathSelectInput),
      candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
    };
    const before = JSON.stringify(input);
    const result = executeLegalPath(input, { select: true, execute: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.mode).toBe("execute_opt_in");
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.executeEnabled).toBe(true);
    expect(result.executed).toBe(true);
    expect(result.sideEffects).toEqual([PACKAGE_LOCAL_EXECUTE_ALLOWED]);
    expect(result.c5Pass).toBe(false);
    expect(result.readyToTighten).toBe(false);
    expect(result.shadowCompared).toBe(false);
    expect(result.enforce).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.mutated).toBe(false);
    // Knife1 select result still reports executed: false
    expect(result.select.executed).toBe(false);
  });

  it("SELECT∧EXECUTE via env snapshot → executed true", () => {
    const result = executeLegalPath(
      { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 },
      {
        env: {
          [LEGAL_PATH_SELECT_ENV]: "1",
          [LEGAL_PATH_EXECUTE_ENV]: "yes",
        },
      },
    );
    expect(result.executed).toBe(true);
    expect(result.executeEnabled).toBe(true);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.sideEffects).toEqual([PACKAGE_LOCAL_EXECUTE_ALLOWED]);
  });

  it("EXECUTE off rollback after succeed path → executed false", () => {
    const input = { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 };
    const succeeded = executeLegalPath(input, { select: true, execute: true });
    expect(succeeded.executed).toBe(true);

    const rolledBack = executeLegalPath(input, {
      select: true,
      execute: false,
      env: { [LEGAL_PATH_EXECUTE_ENV]: "off" },
    });
    expect(rolledBack.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(rolledBack.executeEnabled).toBe(false);
    expect(rolledBack.executed).toBe(false);
    expect(rolledBack.sideEffects).toEqual([]);
    expect(rolledBack.mode).toBe("select_only");
  });

  it("EXECUTE on but no selection → executed false", () => {
    const noCandidate = executeLegalPath(
      { ...sampleLegalPathSelectInput, candidatePath: null },
      { select: true, execute: true },
    );
    expect(noCandidate.selectedPath).toBeNull();
    expect(noCandidate.executeEnabled).toBe(true);
    expect(noCandidate.executed).toBe(false);
    expect(noCandidate.sideEffects).toEqual([]);
    expect(noCandidate.mode).toBe("select_only");

    const executeOnlyNoSelect = executeLegalPath(
      { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 },
      { execute: true },
    );
    expect(executeOnlyNoSelect.select.selectEnabled).toBe(false);
    expect(executeOnlyNoSelect.selectedPath).toBeNull();
    expect(executeOnlyNoSelect.executeEnabled).toBe(true);
    expect(executeOnlyNoSelect.executed).toBe(false);
    expect(executeOnlyNoSelect.mode).toBe("inert");
  });

  it("refuses painted aliases — executed false", () => {
    const painted = [
      "session:main",
      "agent:main:main",
      "lobster-flow",
      "aor-graph",
      "fabric-graph",
      "dormant-orchestration",
      "workflow:demo",
    ];
    for (const candidatePath of painted) {
      const result = executeLegalPath(
        { ...sampleLegalPathSelectInput, candidatePath },
        { select: true, execute: true },
      );
      expect(result.selectedPath).toBeNull();
      expect(result.executed).toBe(false);
      expect(result.paintedAliasUsedAsPath).toBe(false);
      expect(result.sideEffects).toEqual([]);
      expect(result.select.candidateAccepted).toBe(false);
    }
  });

  it("module does not read process.env — EXECUTE in process.env alone stays false", () => {
    expect(isLegalPathExecuteEnabled({})).toBe(false);
    expect(isLegalPathExecuteEnabled({ [LEGAL_PATH_EXECUTE_ENV]: "true" })).toBe(true);
    expect(isLegalPathExecuteEnabled({ [LEGAL_PATH_EXECUTE_ENV]: "off" })).toBe(false);

    const previousSelect = process.env[LEGAL_PATH_SELECT_ENV];
    const previousExecute = process.env[LEGAL_PATH_EXECUTE_ENV];
    process.env[LEGAL_PATH_SELECT_ENV] = "true";
    process.env[LEGAL_PATH_EXECUTE_ENV] = "true";
    try {
      // Omit env snapshot and execute option → still false despite process.env
      const result = executeLegalPath({
        candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
      });
      expect(result.select.selectEnabled).toBe(false);
      expect(result.executeEnabled).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.selectedPath).toBeNull();
    } finally {
      if (previousSelect === undefined) {
        delete process.env[LEGAL_PATH_SELECT_ENV];
      } else {
        process.env[LEGAL_PATH_SELECT_ENV] = previousSelect;
      }
      if (previousExecute === undefined) {
        delete process.env[LEGAL_PATH_EXECUTE_ENV];
      } else {
        process.env[LEGAL_PATH_EXECUTE_ENV] = previousExecute;
      }
    }
  });

  it("does not change selectLegalPath — Knife1 executed stays false", () => {
    const selectOnly = selectLegalPath(
      { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 },
      { select: true },
    );
    expect(selectOnly.executed).toBe(false);
    expect(selectOnly.sideEffects).toEqual([]);
  });
});
