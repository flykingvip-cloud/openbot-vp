/** Narrow storage entry: keep recovery and dispatch out of storage initialization. */
export {
  DIRECTORY_LOCK_STALE_MS,
  appendJsonlDurable,
  withDirectoryLock,
  writeJsonDurable,
} from "./repository/durable-json.js";
