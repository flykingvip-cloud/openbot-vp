/**
 * Artifact Grant methods — gateway method pack (ARTIFACT_GRANT_MVP).
 */
import { artifactGrantHandlers } from "./artifact-grant.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = ["artifact.grant.redeem", "artifact.grant.get"] as const;
const WRITE_METHODS = [
  "artifact.publish",
  "artifact.grant.create",
  "artifact.grant.revoke",
] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const artifactGrantPack = defineGatewayMethodPack({
  id: "artifact-grant",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: artifactGrantHandlers,
});
