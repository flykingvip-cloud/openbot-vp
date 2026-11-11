/** Drop stale observation responses using the existing generation + fingerprint isolation model. */
export type ObservationRequestIsolation = {
  generation: number;
  fingerprint: string;
  connected: boolean;
  authorized: boolean;
  sameClient: boolean;
};

export function isCurrentObservationResponse(
  request: Pick<ObservationRequestIsolation, "generation" | "fingerprint">,
  current: ObservationRequestIsolation,
): boolean {
  return (
    current.connected &&
    current.authorized &&
    current.sameClient &&
    request.generation === current.generation &&
    request.fingerprint === current.fingerprint
  );
}
