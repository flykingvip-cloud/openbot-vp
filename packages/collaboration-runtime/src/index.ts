/**
 * @openbot/collaboration-runtime
 *
 * Runtime coordination logic for OpenBot collaboration groups.
 * This package orchestrates collaboration workflows using host-provided adapters.
 */
export * from "./contracts/index.js";
export * from "./route/index.js";
export * from "./projection/index.js";
export * from "./context/index.js";
export * from "./gates/index.js";

export const COLLABORATION_RUNTIME_VERSION = "0.1.0";
