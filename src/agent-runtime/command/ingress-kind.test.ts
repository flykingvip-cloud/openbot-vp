import { expect, it } from "vitest";
import { isHumanInteractionIngress } from "./ingress-kind.js";
it("routes human messages through interaction while preserving admitted internal entrances", () => {
  expect(isHumanInteractionIngress({})).toBe(true);
  expect(isHumanInteractionIngress({ provenanceKind: "external_user" })).toBe(true);
  for (const provenanceKind of ["internal_system", "inter_session", "cron"]) {
    expect(isHumanInteractionIngress({ provenanceKind })).toBe(false);
  }
  expect(isHumanInteractionIngress({ heartbeat: true })).toBe(false);
  expect(isHumanInteractionIngress({ birthTurn: true })).toBe(false);
  expect(isHumanInteractionIngress({ collaborationRound: true })).toBe(false);
});
