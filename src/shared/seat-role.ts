/**
 * Team seat role shared by the package matrix and gateway billing.
 * Lives here so `src/shared` does not import `src/gateway`.
 */
export type SeatRole = "viewer" | "creator" | "admin";
