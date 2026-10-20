import { evolutionPerceptionHandlers } from "./evolution-perception.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = ["evolution.perception.query", "evolution.perception.project"] as const;

export const EVOLUTION_PERCEPTION_METHODS = READ_METHODS;

export const evolutionPerceptionPack = defineGatewayMethodPack({
  id: "evolution-perception",
  methods: EVOLUTION_PERCEPTION_METHODS,
  scopes: {
    "operator.read": READ_METHODS,
  },
  handlers: evolutionPerceptionHandlers,
});
