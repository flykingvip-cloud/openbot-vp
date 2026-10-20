/**
 * group.sharedDoc.* method pack.
 */
import { groupSharedDocHandlers } from "./group-shared-doc.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = ["group.sharedDoc.open", "group.sharedDoc.listReviews"] as const;
const WRITE_METHODS = [
  "group.sharedDoc.claimSection",
  "group.sharedDoc.writeBody",
  "group.sharedDoc.appendReview",
] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const groupSharedDocPack = defineGatewayMethodPack({
  id: "group-shared-doc",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: groupSharedDocHandlers,
});
