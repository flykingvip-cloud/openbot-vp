/**
 * Citation URI helpers matching resolve-engine (ku://kb|workspace|active).
 * Do not invent a second coordinate scheme.
 */

export type KnowledgeCiteUri =
  | {
      kind: "document";
      kbId: string;
      docId: string;
      versionId: string;
      section?: string;
    }
  | {
      kind: "deliverable";
      workspaceId: string;
      deliverableId: string;
      versionId: string;
    }
  | {
      kind: "active";
      sourceId: string;
      route: string;
    };

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildDocumentCiteUri(params: {
  kbId: string;
  docId: string;
  versionId: string;
  section?: string;
}): string {
  const base = `ku://kb/${encodeURIComponent(params.kbId)}/doc/${encodeURIComponent(params.docId)}@${params.versionId}`;
  const section = params.section?.trim();
  return section ? `${base}#${section}` : base;
}

export function buildDeliverableCiteUri(params: {
  workspaceId: string;
  deliverableId: string;
  versionId: string;
}): string {
  return `ku://workspace/${encodeURIComponent(params.workspaceId)}/deliverable/${encodeURIComponent(params.deliverableId)}@${params.versionId}`;
}

export function buildActiveCiteUri(params: { sourceId: string; requestPath: string }): string {
  const routeOnly = params.requestPath.split(/[?#]/, 1)[0] ?? params.requestPath;
  return `ku://active/${params.sourceId}${routeOnly}`;
}

export function parseCiteUri(uri: string): KnowledgeCiteUri | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith("ku://")) {
    return null;
  }

  const documentMatch = /^ku:\/\/kb\/([^/]+)\/doc\/([^@#]+)@([^#]+)(?:#(.*))?$/.exec(trimmed);
  if (documentMatch) {
    const section = documentMatch[4]?.trim();
    return {
      kind: "document",
      kbId: decodePart(documentMatch[1] ?? ""),
      docId: decodePart(documentMatch[2] ?? ""),
      versionId: documentMatch[3] ?? "",
      ...(section ? { section } : {}),
    };
  }

  const deliverableMatch = /^ku:\/\/workspace\/([^/]+)\/deliverable\/([^@#]+)@(.+)$/.exec(trimmed);
  if (deliverableMatch) {
    return {
      kind: "deliverable",
      workspaceId: decodePart(deliverableMatch[1] ?? ""),
      deliverableId: decodePart(deliverableMatch[2] ?? ""),
      versionId: deliverableMatch[3] ?? "",
    };
  }

  const activeMatch = /^ku:\/\/active\/([^/]+)(\/.*)?$/.exec(trimmed);
  if (activeMatch) {
    return {
      kind: "active",
      sourceId: activeMatch[1] ?? "",
      route: activeMatch[2] ?? "",
    };
  }

  return null;
}
