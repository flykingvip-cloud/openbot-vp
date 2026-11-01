/**
 * Same subject string the chat entry stores on TaskOutcome scope.
 * This is not a platformUserId ↔ subjectRef map. Callers either already
 * match this form, or they are not the task owner.
 */
export function normalizeTaskOutcomeSubjectRef(raw: string | null | undefined): string {
  const subjectRef = raw?.trim() ?? "";
  if (!subjectRef) {
    return "";
  }
  if (subjectRef.startsWith("platform-user:")) {
    return subjectRef;
  }
  if (subjectRef.includes(":")) {
    return subjectRef;
  }
  return `subject:${subjectRef}`;
}
