import { expect, it } from "vitest";
import { assembleCollaborationMember, assembleIndividual } from "../assembly.js";
import { COLLABORATION_MEMBER_CONTEXT_ORDER } from "./collaboration-member.js";
import { INDIVIDUAL_CONTEXT_ORDER } from "./individual.js";
import { INDIVIDUAL_FORBIDDEN_GROUP_MATERIALS, selectContextCatalog } from "./select-catalog.js";

it("does not select the collaboration catalog from chat type alone", () => {
  expect(selectContextCatalog({ chatType: "group", collaborationAssembly: false })).toBe(
    "individual",
  );
  expect(selectContextCatalog({ chatType: "channel", collaborationAssembly: false })).toBe(
    "individual",
  );
  expect(selectContextCatalog({ chatType: "direct", collaborationAssembly: true })).toBe(
    "collaboration-member",
  );
  expect(selectContextCatalog({ collaborationAssembly: true })).toBe("collaboration-member");
});

it("fails individual assembly for every group-layer id", () => {
  for (const id of INDIVIDUAL_FORBIDDEN_GROUP_MATERIALS) {
    expect(() => assembleIndividual({ [id]: "group material" } as never)).toThrow(/not allowed/);
    expect(INDIVIDUAL_CONTEXT_ORDER).not.toContain(id);
  }
});

it("keeps the existing collaboration material order after the member prefix", () => {
  expect(COLLABORATION_MEMBER_CONTEXT_ORDER).toEqual([
    "operationalIdentity",
    "charter",
    "mission",
    "delivery",
    "phase",
    "groupContext",
    "groupIntro",
    "continuity",
    "capabilities",
    "groupSystemPrompt",
    "inboundMetadata",
  ]);
  expect(
    assembleCollaborationMember({
      operationalIdentity: "id",
      charter: "charter",
      groupContext: "group",
      inboundMetadata: "meta",
    }),
  ).toEqual(["id", "charter", "group", "meta"]);
});
