import { createHash, createHmac, randomBytes } from "node:crypto";

export type KnowledgeActorContext = {
  issuer: string;
  subjectId: string;
  tenantId: string;
  policyGeneration: number;
  actorType: "human";
  agentId: string;
  requestId: string;
  roles?: string[];
  departmentIds?: string[];
  orgRoles?: string[];
  clearanceLevel?: string;
  sessionId?: string;
  profileGeneration?: number;
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
    // Only boolean true is published; a truthy check would accept coerced values.
    // oxlint-disable-next-line typescript-eslint/no-unnecessary-boolean-literal-compare
    value.activated === true &&
    value.lifecycle_state === "published" &&
    value.created_version === value.current_version
  );
}

/** Allowed IdentityContext purposes from SDK pin 9940818b v2_schemas.py. */
export const KNOWLEDGE_SDK_V2_PURPOSES = [
  "read",
  "ground_internal_llm",
  "ground_external_llm",
  "export",
  "eval_and_train",
] as const;
export type KnowledgeSdkV2Purpose = (typeof KNOWLEDGE_SDK_V2_PURPOSES)[number];

/**
 * Exact eight Wave2 routes from knowledge_sdk.server.v2.ROUTES at pin 9940818b.
 * v2_auth takes purpose from the signed IdentityContext and passes it to policy;
 * the runtime does not remap purpose per route. Official wave2 tests
 * (test_runtime.py context(), test_sandbox.py) and the Python client defaults
 * (client/base.py) use Purpose.READ for create_kb, list_kbs, ingest,
 * get_document, rollback_document, search, and verify_ref. Pack endpoints that
 * default to EXPORT are outside this minimum slice. Unknown paths fail closed.
 */
export const KNOWLEDGE_SDK_V2_ROUTE_PURPOSES = {
  "POST /v2/spaces": "read",
  "GET /v2/spaces": "read",
  "GET /v2/spaces/{kb_id}": "read",
  "POST /v2/assets": "read",
  "GET /v2/assets/{doc_id}": "read",
  "POST /v2/assets/{doc_id}:rollback": "read",
  "POST /v2/retrieval:search": "read",
  "POST /v2/citations:verify": "read",
} as const satisfies Record<string, KnowledgeSdkV2Purpose>;

export function purposeForV2Route(method: "GET" | "POST", path: string): KnowledgeSdkV2Purpose {
  if (path.includes("?") || path.includes("#") || path.includes("//")) {
    throw new KnowledgeSdkError("INVALID_SDK_CONFIGURATION");
  }
  for (const [route, purpose] of Object.entries(KNOWLEDGE_SDK_V2_ROUTE_PURPOSES)) {
    const space = route.indexOf(" ");
    const routeMethod = route.slice(0, space);
    const routePath = route.slice(space + 1);
    if (routeMethod !== method) {
      continue;
    }
    const pattern = new RegExp(`^${routePath.replace(/\{[a-z_]+\}/g, "[^/?#:]+")}$`);
    if (pattern.test(path)) {
      return purpose;
    }
  }
  throw new KnowledgeSdkError("INVALID_SDK_CONFIGURATION");
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
    const purpose = purposeForV2Route(method, path);
    const body = method === "GET" ? "" : JSON.stringify(payload ?? {});
    const actorHeader = Buffer.from(
      JSON.stringify({
        request_id: actor.requestId,
        tenant_id: actor.tenantId,
        actor: {
          issuer: actor.issuer,
          subject_id: actor.subjectId,
          actor_type: "human",
          roles: actor.roles ?? [],
          department_ids: actor.departmentIds ?? [],
          ancestor_department_ids: [],
          org_roles: actor.orgRoles ?? [],
          clearance_level: actor.clearanceLevel ?? "",
          clearance_tags: [],
          policy_generation: actor.policyGeneration,
          session_id: actor.sessionId ?? "",
        },
        agent: {
          agent_id: actor.agentId,
          profile_generation: actor.profileGeneration ?? 1,
          task_id: "",
        },
        purpose,
      }),
    ).toString("base64url");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(24).toString("hex");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-Id": actor.requestId,
      "X-Tenant-Id": actor.tenantId,
      "X-KB-Actor": actorHeader,
      "X-KB-Timestamp": timestamp,
      "X-KB-Nonce": nonce,
    };
    headers["X-KB-Signature"] = signRequest(
      {
        method,
        target: path,
        actorHeader,
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
      const envelope: unknown = await response.json().catch(() => null);
      let code = "SDK_REQUEST_DENIED";
      if (envelope && typeof envelope === "object" && "error" in envelope) {
        const error = envelope.error;
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string" &&
          /^[A-Z_]+$/.test(error.code)
        ) {
          code = error.code;
        }
      }
      throw new KnowledgeSdkError(code, response.status);
    }
    return response.json();
  }
}
