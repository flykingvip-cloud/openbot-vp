/**
 * @openbot/collaboration-openbot-adapter
 *
 * OpenBot-specific adapters for collaboration packages.
 * This package bridges collaboration-core and collaboration-runtime
 * to OpenBot's existing infrastructure (storage, audit, sessions, directory).
 */
export * from "./storage/index.js";
export * from "./audit/index.js";
export * from "./session/index.js";
export * from "./directory/index.js";

export const COLLABORATION_OPENBOT_ADAPTER_VERSION = "0.1.0";
