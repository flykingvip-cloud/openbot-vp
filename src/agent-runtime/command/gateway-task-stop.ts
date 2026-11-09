export type GatewayTaskStopPorts = {
  /** Preserve asynchronous chat abortion (including existing partial handling) first. */
  abortChatRuns: () => Promise<void>;
  abortEmbedded: () => void;
  clearPending: () => void;
};

/** Already-admitted Gateway stop; state, protocol replies and session scope stay at the adapter. */
export async function stopTaskAtGateway(
  ownerAbortInFlight: boolean,
  ports: GatewayTaskStopPorts,
): Promise<void> {
  await ports.abortChatRuns();
  if (ownerAbortInFlight) {
    ports.abortEmbedded();
    ports.clearPending();
  }
}
