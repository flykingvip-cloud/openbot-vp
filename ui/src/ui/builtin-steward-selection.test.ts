import { describe, expect, it } from "vitest";
import {
  isBuiltinStewardEntry,
  isBuiltinStewardSelection,
  isEmployeeBuiltinStewardSessionAlias,
  sessionKeyMatchesBuiltinSteward,
} from "./builtin-steward-selection.ts";

describe("builtin-steward-selection", () => {
  const defaults = {
    mainSessionKey: "agent:main:main",
    mainKey: "main",
    defaultAgentId: "agent-sales",
  };

  it("matches bare main and canonical mainSessionKey aliases", () => {
    expect(sessionKeyMatchesBuiltinSteward("main", defaults)).toBe(true);
    expect(sessionKeyMatchesBuiltinSteward("agent:main", defaults)).toBe(true);
    expect(sessionKeyMatchesBuiltinSteward("agent:main:main", defaults)).toBe(true);
    expect(sessionKeyMatchesBuiltinSteward("agent:agent-sales:main", defaults)).toBe(true);
  });

  it("does not treat unrelated agent sessions as steward", () => {
    expect(sessionKeyMatchesBuiltinSteward("agent:agent-sales:main:space:x", defaults)).toBe(false);
    expect(sessionKeyMatchesBuiltinSteward("agent:analyst:main", defaults)).toBe(false);
  });

  it("detects steward workbench selection across session and nav key", () => {
    expect(
      isBuiltinStewardSelection({
        sessionKey: "agent:main:main",
        workbenchTeamSelectedKey: "agent:agent-sales:telegram:direct:alice",
        sessionDefaults: defaults,
      }),
    ).toBe(true);
    expect(
      isBuiltinStewardSelection({
        sessionKey: "agent:main:employee:ceo-example-com",
        workbenchTeamSelectedKey: "agent:main:employee:ceo-example-com",
        sessionDefaults: defaults,
      }),
    ).toBe(true);
    expect(
      isBuiltinStewardSelection({
        sessionKey: "agent:analyst:main",
        workbenchTeamSelectedKey: "agent:analyst:main",
        sessionDefaults: defaults,
      }),
    ).toBe(false);
  });

  it("detects steward nav entries by id and session keys", () => {
    expect(
      isBuiltinStewardEntry(
        {
          key: "agent:main:main",
          id: "main",
          sessionKeys: ["agent:main:main", "main"],
        },
        defaults,
      ),
    ).toBe(true);
    expect(
      isBuiltinStewardEntry(
        {
          key: "agent:analyst:main",
          id: "analyst",
          sessionKeys: ["agent:analyst:main"],
        },
        defaults,
      ),
    ).toBe(false);
  });

  it("treats employee steward aliases as canonicalizable", () => {
    expect(isEmployeeBuiltinStewardSessionAlias("")).toBe(true);
    expect(isEmployeeBuiltinStewardSessionAlias("main")).toBe(true);
    expect(isEmployeeBuiltinStewardSessionAlias("agent:main")).toBe(true);
    expect(isEmployeeBuiltinStewardSessionAlias("agent:main:main")).toBe(true);
    expect(isEmployeeBuiltinStewardSessionAlias("agent:main:employee:elledecke204")).toBe(true);
    expect(isEmployeeBuiltinStewardSessionAlias("agent:main:space:team-a")).toBe(false);
    expect(isEmployeeBuiltinStewardSessionAlias("agent:analyst:main")).toBe(false);
  });
});
