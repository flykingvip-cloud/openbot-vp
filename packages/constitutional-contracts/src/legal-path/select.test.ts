import { describe, expect, it } from "vitest";
import {
  CONSTITUTIONAL_DECLARED_PATH_V1,
  DECLARED_LEGAL_PATHS,
  LEGAL_PATH_SELECT_ENV,
  PHASE_D_P8B_KNIFE1_SCOPE,
  isDeclaredLegalPath,
  isLegalPathSelectEnabled,
  listEffectiveLegalPaths,
  sampleLegalPathSelectInput,
  selectLegalPath,
} from "../index.js";

describe("P8b Knife1 legal-path select", () => {
  it("registers exactly one versioned declared legal Path", () => {
    expect(DECLARED_LEGAL_PATHS).toHaveLength(1);
    expect(DECLARED_LEGAL_PATHS[0]?.id).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(DECLARED_LEGAL_PATHS[0]?.version).toBe(1);
    expect(DECLARED_LEGAL_PATHS[0]?.selectionAuthorized).toBe(true);
    expect(DECLARED_LEGAL_PATHS[0]?.executionAuthorized).toBe(false);
    expect(isDeclaredLegalPath(CONSTITUTIONAL_DECLARED_PATH_V1)).toBe(true);
    expect(isDeclaredLegalPath("session:main")).toBe(false);
    expect(isDeclaredLegalPath("lobster")).toBe(false);
  });

  it("stays inert and empty unless selection is explicitly requested", () => {
    const input = structuredClone(sampleLegalPathSelectInput);
    const before = JSON.stringify(input);
    const previous = process.env[LEGAL_PATH_SELECT_ENV];
    process.env[LEGAL_PATH_SELECT_ENV] = "true";
    try {
      const result = selectLegalPath(input);
      expect(JSON.stringify(input)).toBe(before);
      expect(result.scope).toBe(PHASE_D_P8B_KNIFE1_SCOPE);
      expect(result.mode).toBe("inert");
      expect(result.invoked).toBe(false);
      expect(result.selectEnabled).toBe(false);
      expect(result.effectiveLegalPathIds).toEqual([]);
      expect(result.selectedPath).toBeNull();
      expect(result.legalPathSelectable).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.sideEffects).toEqual([]);
      expect(result.enforce).toBe(false);
      expect(result.liveInvoke).toBe(false);
      expect(result.fabricDefaultOn).toBe(false);
      expect(result.readyToTighten).toBe(false);
      expect(result.c5Pass).toBe(false);
      expect(listEffectiveLegalPaths()).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env[LEGAL_PATH_SELECT_ENV];
      } else {
        process.env[LEGAL_PATH_SELECT_ENV] = previous;
      }
    }
  });

  it("selects the declared Path when opted in and does not execute", () => {
    const input = {
      ...structuredClone(sampleLegalPathSelectInput),
      candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1,
    };
    const before = JSON.stringify(input);
    const result = selectLegalPath(input, { select: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(result.mode).toBe("select_only");
    expect(result.invoked).toBe(true);
    expect(result.selectEnabled).toBe(true);
    expect(result.effectiveLegalPathIds).toEqual([CONSTITUTIONAL_DECLARED_PATH_V1]);
    expect(result.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(result.candidatePresent).toBe(true);
    expect(result.candidateAccepted).toBe(true);
    expect(result.legalPathSelectable).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.sideEffects).toEqual([]);
    expect(result.paintedAliasUsedAsPath).toBe(false);
    expect(result.c5Pass).toBe(false);
    expect(result.readyToTighten).toBe(false);
    expect(result.shadowCompared).toBe(false);
    expect(result.enforce).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
    expect(JSON.stringify(result)).not.toContain("lobster");
    expect(JSON.stringify(result)).not.toContain("agent:main:main");
    expect(JSON.stringify(result)).not.toContain("aor-graph");
    expect(JSON.stringify(result)).not.toContain("fabric-graph");
    expect(JSON.stringify(result)).not.toContain("dormant-orchestration");
  });

  it("refuses painted candidates without selecting or executing them", () => {
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
      const result = selectLegalPath(
        { ...sampleLegalPathSelectInput, candidatePath },
        { select: true },
      );
      expect(result.selectedPath).toBeNull();
      expect(result.candidatePresent).toBe(true);
      expect(result.candidateAccepted).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.paintedAliasUsedAsPath).toBe(false);
      expect(result.legalPathSelectable).toBe(true);
    }
  });

  it("rolls back to an empty effective set when the flag is off", () => {
    expect(listEffectiveLegalPaths({ select: true })).toHaveLength(1);
    expect(listEffectiveLegalPaths({ env: { [LEGAL_PATH_SELECT_ENV]: "false" } })).toEqual([]);
    const result = selectLegalPath(
      { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 },
      { env: { [LEGAL_PATH_SELECT_ENV]: "off" } },
    );
    expect(result.selectEnabled).toBe(false);
    expect(result.selectedPath).toBeNull();
    expect(result.effectiveLegalPathIds).toEqual([]);
    expect(result.executed).toBe(false);
  });

  it("lets an explicit env snapshot enable selection without reading process.env", () => {
    expect(isLegalPathSelectEnabled({})).toBe(false);
    expect(isLegalPathSelectEnabled({ [LEGAL_PATH_SELECT_ENV]: "true" })).toBe(true);
    expect(isLegalPathSelectEnabled({ [LEGAL_PATH_SELECT_ENV]: "off" })).toBe(false);

    const selected = selectLegalPath(
      { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 },
      { env: { [LEGAL_PATH_SELECT_ENV]: "yes" } },
    );
    expect(selected.invoked).toBe(true);
    expect(selected.selectedPath).toBe(CONSTITUTIONAL_DECLARED_PATH_V1);
    expect(selected.executed).toBe(false);
    expect(selected.enforce).toBe(false);
    expect(selected.liveInvoke).toBe(false);
    expect(selected.fabricDefaultOn).toBe(false);

    const quiet = selectLegalPath(
      { candidatePath: CONSTITUTIONAL_DECLARED_PATH_V1 },
      { env: { [LEGAL_PATH_SELECT_ENV]: "false" } },
    );
    expect(quiet.invoked).toBe(false);
    expect(quiet.selectedPath).toBeNull();
    expect(quiet.executed).toBe(false);
  });
});
