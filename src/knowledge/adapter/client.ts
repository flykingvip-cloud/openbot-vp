import { createHash, createHmac, randomBytes } from "node:crypto";

export type KnowledgeActorContext = {
  issuer: string;
  subjectId: string;
  tenantId: string;
  policyGeneration: number;
  actorType: "human";
  agentId: string;
  requestId: string;
};
export type AdapterConfig = {
  enabled: boolean;
  environment: "test" | "development" | "production";
  allowedTenantIds: readonly string[];
  baseUrl: string;
  timeoutMs: number;
  secret: string;
};
export class KnowledgeSdkError extends Error {
  constructor(
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(code);
    this.name = "KnowledgeSdkError";
  }
}
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
export function signRequest(
  input: {
    method: string;
    target: string;
    actorHeader: string;
    timestamp: string;
    nonce: string;
    body: string;
    agentHeader?: string;
    purpose?: string;
  },
  secret: string,
): string {
  const lines = [
    input.method.toUpperCase(),
    input.target,
    input.actorHeader,
    input.timestamp,
    input.nonce,
    sha256(input.body),
  ];
  if (input.agentHeader !== undefined || input.purpose !== undefined) {
    lines.push(input.agentHeader ?? "", input.purpose ?? "");
  }
  return createHmac("sha256", secret).update(lines.join("\n"), "utf8").digest("hex");
}
export function assertActor(actor: KnowledgeActorContext): void {
  if (
    actor.actorType !== "human" ||
    !actor.issuer?.trim() ||
    !actor.subjectId?.trim() ||
    actor.subjectId.includes("@") ||
    !actor.tenantId?.trim() ||
    !actor.agentId?.trim() ||
    !actor.requestId?.trim() ||
    !Number.isSafeInteger(actor.policyGeneration) ||
    actor.policyGeneration < 1
  ) {
    throw new KnowledgeSdkError("INVALID_TRUSTED_CONTEXT");
  }
}
export function isPublishedResult(value: {
  activated: boolean;
  lifecycle_state: string;
  created_version: number;
  current_version: number;
}): boolean {
  return (
    value.activated &&
    value.lifecycle_state === "published" &&
    value.created_version === value.current_version
  );
}
/** Experimental contract-stub transport only. Not wired into Gateway or SDK runtime.
 * V2 authentication binding must be verified against the nominated Wave2 fixture.
 * Caller must derive actor from authenticated server state, never tool parameters. */
export class KnowledgeSdkClient {
  constructor(
    private readonly config: AdapterConfig,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async request(
    path: string,
    method: "GET" | "POST",
    actor: KnowledgeActorContext,
    payload?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    assertActor(actor);
    if (
      !this.config.enabled ||
      this.config.environment === "production" ||
      !this.config.allowedTenantIds.includes(actor.tenantId)
    ) {
      throw new KnowledgeSdkError("SDK_PATH_DISABLED");
    }
    const base = new URL(this.config.baseUrl);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !path.startsWith("/v2/") ||
      path.includes("#") ||
      Buffer.byteLength(this.config.secret) < 32
    ) {
      throw new KnowledgeSdkError("INVALID_SDK_CONFIGURATION");
    }
    const body = method === "GET" ? "" : JSON.stringify(payload ?? {});
    const actorHeader = Buffer.from(
      JSON.stringify({
        issuer: actor.issuer,
        subject_id: actor.subjectId,
        actor_type: actor.actorType,
        policy_generation: actor.policyGeneration,
      }),
    ).toString("base64url");
    const agentHeader = Buffer.from(JSON.stringify({ agent_id: actor.agentId })).toString(
      "base64url",
    );
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(24).toString("hex");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-Id": actor.requestId,
      "X-Tenant-Id": actor.tenantId,
      "X-KB-Actor": actorHeader,
      "X-KB-Agent": agentHeader,
      "X-KB-Purpose": "ground_internal_llm",
      "X-KB-Timestamp": timestamp,
      "X-KB-Nonce": nonce,
    };
    headers["X-KB-Signature"] = signRequest(
      {
        method,
        target: path,
        actorHeader,
        agentHeader,
        purpose: headers["X-KB-Purpose"],
        timestamp,
        nonce,
        body,
      },
      this.config.secret,
    );
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    // Exactly one attempt, including idempotent writes. No legacy engine dependency.
    let response: Response;
    try {
      response = await this.transport(new URL(path, base), {
        method,
        headers,
        body: method === "GET" ? undefined : body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new KnowledgeSdkError("SDK_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new KnowledgeSdkError(
        response.status === 409 ? "IDEMPOTENCY_CONFLICT" : "SDK_REQUEST_DENIED",
        response.status,
      );
    }
    return response.json();
  }
}
