import { loadLogs, type LogsLoadState } from "../../controllers/logs.ts";

export type LogsCapabilityLoadState = LogsLoadState;

export const logsCapability = {
  load: loadLogs,
} as const;
