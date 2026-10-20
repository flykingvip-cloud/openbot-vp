export type EvidenceDrawerTab = {
  key: string;
  label: string;
  content: string;
};

export type EvidenceDrawerDocument = {
  tabs: EvidenceDrawerTab[];
};

export type EvidenceDrawerPayload = {
  mode: string;
  messageKey: string;
  content: EvidenceDrawerDocument;
  title?: string;
};

export function buildEvidenceDrawerDocument(tabs: EvidenceDrawerTab[]): EvidenceDrawerDocument {
  return { tabs };
}

export function encodeEvidenceDrawerContent(payload: EvidenceDrawerPayload): string {
  return JSON.stringify({
    mode: payload.mode,
    messageKey: payload.messageKey,
    content: payload.content,
    ...(payload.title ? { title: payload.title } : {}),
  });
}
