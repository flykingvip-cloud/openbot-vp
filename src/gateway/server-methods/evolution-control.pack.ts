import { evolutionControlHandlers } from "./evolution-control.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = [
  "evolution.surfaces.list",
  "evolution.proposals.list",
  "evolution.proposals.get",
  "evolution.experiments.get",
  "evolution.verifications.get",
  "evolution.ledger.query",
  "evolution.diagnosis.status",
] as const;

const WRITE_METHODS = [
  "evolution.proposals.transition",
  "evolution.proposals.authorize",
  "evolution.experiments.create",
  "evolution.experiments.evaluate",
  "evolution.applications.apply",
  "evolution.applications.verify",
  "evolution.applications.rollback",
  "evolution.task-outcomes.record",
  "evolution.working-dna.verify-effect",
  "evolution.working-dna.evaluate-promote",
  "evolution.diagnosis.submit",
  "evolution.diagnosis.recheck",
  "evolution.applications.approve",
] as const;

export const EVOLUTION_CONTROL_METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const evolutionControlPack = defineGatewayMethodPack({
  id: "evolution-control",
  methods: EVOLUTION_CONTROL_METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.approvals": WRITE_METHODS,
  },
  handlers: evolutionControlHandlers,
});
