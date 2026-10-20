import {
  loadGatewayMemoryDoctorStatus,
  type MemoryDoctorStatusPayload,
} from "../../memory/doctor-status.js";
import { formatError } from "../server-utils.js";
import { doctorMemoryHealthHandlers } from "./doctor-memory-health.js";
import type { GatewayRequestHandlers } from "./types.js";

export type DoctorMemoryStatusPayload = MemoryDoctorStatusPayload;

export const doctorHandlers: GatewayRequestHandlers = {
  ...doctorMemoryHealthHandlers,
  "doctor.memory.status": async ({ respond }) => {
    try {
      const payload = await loadGatewayMemoryDoctorStatus({ probeEmbeddings: true });
      respond(true, payload, undefined);
    } catch (err) {
      const payload: DoctorMemoryStatusPayload = {
        agentId: "main",
        embedding: {
          ok: false,
          error: `gateway memory probe failed: ${formatError(err)}`,
        },
      };
      respond(true, payload, undefined);
    }
  },
};
