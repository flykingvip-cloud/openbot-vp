/**
 * Event and capability names shared by both ends of the local disk read grant.
 *
 * Kept in the shared module rather than on either side so the gateway emitter and
 * the node listener cannot drift apart.
 */

/** Gateway -> node: the signed capability verification keyset (design 9.3). */
export const LOCAL_FILES_KEYSET_EVENT = "localFiles.keyset";

/** Capability a node advertises when it runs the read-only file profile. */
export const LOCAL_FILES_CAP = "local-files";

/** Node -> gateway RPC used to redeem one Invocation capability. */
export const LOCAL_FILES_REDEEM_METHOD = "localFiles.redeem";

/** Gateway -> clients: an approval card should be shown (design 4.11). */
export const LOCAL_FILES_APPROVAL_REQUESTED_EVENT = "localFiles.approval.requested";

/** Gateway -> clients: an approval was settled. */
export const LOCAL_FILES_APPROVAL_RESOLVED_EVENT = "localFiles.approval.resolved";

/** Client -> gateway RPC carrying the user's decision. */
export const LOCAL_FILES_APPROVAL_RESOLVE_METHOD = "localFiles.approval.resolve";
