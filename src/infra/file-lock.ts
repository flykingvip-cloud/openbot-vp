export type {
  FileLockHandle,
  FileLockHandleSync,
  FileLockOptions,
} from "../plugin-sdk/file-lock.js";
export {
  acquireFileLock,
  acquireFileLockSync,
  withFileLock,
  withFileLockSync,
} from "../plugin-sdk/file-lock.js";

/** Default retries for session task board / other sync JSON stores. */
export const SESSION_TASK_BOARD_LOCK_OPTIONS: import("../plugin-sdk/file-lock.js").FileLockOptions =
  {
    retries: {
      retries: 40,
      factor: 1.3,
      minTimeout: 10,
      maxTimeout: 200,
      randomize: true,
    },
    stale: 15_000,
  };
