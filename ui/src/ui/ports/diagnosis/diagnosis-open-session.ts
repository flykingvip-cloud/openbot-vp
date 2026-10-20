export const DIAGNOSIS_OPEN_SESSION_EVENT = "diagnosis-open-session";

export type DiagnosisOpenSessionDetail = {
  sessionKey: string;
};

export function dispatchDiagnosisOpenSession(host: EventTarget, sessionKey: string): void {
  const key = sessionKey.trim();
  if (!key) {
    return;
  }
  host.dispatchEvent(
    new CustomEvent<DiagnosisOpenSessionDetail>(DIAGNOSIS_OPEN_SESSION_EVENT, {
      detail: { sessionKey: key },
      bubbles: true,
      composed: true,
    }),
  );
}

export function readDiagnosisOpenSession(event: Event): DiagnosisOpenSessionDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }
  const sessionKey =
    typeof event.detail?.sessionKey === "string" ? event.detail.sessionKey.trim() : "";
  if (!sessionKey) {
    return null;
  }
  return { sessionKey };
}
