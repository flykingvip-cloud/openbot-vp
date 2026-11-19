/** Narrow durable-storage port: avoid loading runtime recovery and dispatch during initialization. */
export {
  DIRECTORY_LOCK_STALE_MS,
  withDirectoryLock,
  appendJsonlDurable,
  writeJsonDurable,
} from "./repository/durable-json.js";
