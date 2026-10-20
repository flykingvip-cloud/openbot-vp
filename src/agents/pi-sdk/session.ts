import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";

export class SessionVersionError extends Error {
  readonly sessionFile: string;
  readonly headerVersion: number | undefined;

  constructor(sessionFile: string, headerVersion: number | undefined) {
    super(
      headerVersion === undefined
        ? `Session file is missing a usable header: ${sessionFile}`
        : `Session file version ${headerVersion} is newer than supported ${CURRENT_SESSION_VERSION}: ${sessionFile}`,
    );
    this.name = "SessionVersionError";
    this.sessionFile = sessionFile;
    this.headerVersion = headerVersion;
  }
}

function assertSupportedHeader(sessionFile: string, header: SessionHeader | null): SessionHeader {
  if (!header || header.type !== "session" || typeof header.id !== "string" || !header.id) {
    throw new SessionVersionError(sessionFile, undefined);
  }
  if (typeof header.version !== "number") {
    throw new SessionVersionError(sessionFile, undefined);
  }
  if (header.version > CURRENT_SESSION_VERSION) {
    throw new SessionVersionError(sessionFile, header.version);
  }
  return header;
}

/**
 * Open an existing session and fail closed on missing/future headers.
 * Earendil 0.84 already throws on non-empty files without a session header;
 * this wrapper also rejects `version > CURRENT_SESSION_VERSION`, which the SDK
 * still reads.
 */
export function openSessionManager(
  sessionFile: string,
  sessionDir?: string,
  cwdOverride?: string,
): SessionManager {
  const sessionManager = SessionManager.open(sessionFile, sessionDir, cwdOverride);
  assertSupportedHeader(sessionFile, sessionManager.getHeader());
  return sessionManager;
}
