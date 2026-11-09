/** Transport provenance selects an entrance, never a second semantic classifier. */
export function isHumanInteractionIngress(input: {
  provenanceKind?: string;
  heartbeat?: boolean;
  birthTurn?: boolean;
  collaborationRound?: boolean;
}): boolean {
  return (
    !input.heartbeat &&
    !input.birthTurn &&
    !input.collaborationRound &&
    (!input.provenanceKind || input.provenanceKind === "external_user")
  );
}
