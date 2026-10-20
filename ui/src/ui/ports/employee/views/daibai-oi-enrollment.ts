/**
 * Stage B OI CTA subject resolution.
 * Builds an oi_enrollment create payload from a real identity id already in context.
 * Never invents an identity id, and never authorizes or grants.
 */

export const DAIBAI_OI_IDENTITY_MISSING =
  "缺少运营身份编号，无法提交企业审批。请先在运营身份页登记身份后再提交；通过后仍需本人或管理员显式开通，不会自动授权。";

export const DAIBAI_OI_IDENTITY_AMBIGUOUS =
  "有多个运营身份，无法确定申请对象。请先到运营身份页选定后再提交；不会自动授权。";

export const DAIBAI_OI_AGENT_MISSING = "缺少数字员工编号，无法提交运营身份审批。";

export type DaibaiOiIdentityRef = {
  identityId: string;
  status?: string;
};

export type DaibaiOiGrantRef = {
  identityId: string;
  agentId: string;
  status?: string;
};

/** Employee-visible identity lists. Null means not loaded; an empty list means loaded and empty. */
export type DaibaiOiIdentityContext = {
  personalIdentities?: readonly DaibaiOiIdentityRef[] | null;
  personalGrants?: readonly DaibaiOiGrantRef[] | null;
  /** Keyed by agent id. A missing key is "not loaded for this agent", not "none". */
  enterpriseIdentitiesByAgent?: Readonly<
    Record<string, readonly DaibaiOiIdentityRef[] | null | undefined>
  > | null;
  enterpriseSeatIdentities?: readonly DaibaiOiIdentityRef[] | null;
};

export type DaibaiOiEnrollmentResolveResult =
  | { ok: true; identityId: string }
  | { ok: false; message: string };

export type DaibaiOiEnrollmentCreateInput = {
  identityScope: "personal" | "enterprise";
  identityId: string;
  targetAgentId: string;
  catalogId: string;
  templateId: string;
  clientRequestId: string;
  reason?: string;
  tenantId?: string;
};

function usableIdentityId(identity: DaibaiOiIdentityRef): string | null {
  const identityId = identity.identityId.trim();
  if (!identityId) {
    return null;
  }
  if (identity.status?.trim().toLowerCase() === "revoked") {
    return null;
  }
  return identityId;
}

function uniqueUsableIds(identities: readonly DaibaiOiIdentityRef[]): string[] {
  const ids = new Set<string>();
  for (const identity of identities) {
    const identityId = usableIdentityId(identity);
    if (identityId) {
      ids.add(identityId);
    }
  }
  return [...ids];
}

function pickSingle(ids: readonly string[]): DaibaiOiEnrollmentResolveResult | null {
  if (ids.length === 1) {
    return { ok: true, identityId: ids[0] ?? "" };
  }
  if (ids.length > 1) {
    return { ok: false, message: DAIBAI_OI_IDENTITY_AMBIGUOUS };
  }
  return null;
}

function resolvePersonalIdentity(input: {
  targetAgentId: string;
  personalIdentities: readonly DaibaiOiIdentityRef[] | null;
  personalGrants: readonly DaibaiOiGrantRef[] | null;
}): DaibaiOiEnrollmentResolveResult {
  if (input.personalIdentities === null && input.personalGrants === null) {
    return { ok: false, message: DAIBAI_OI_IDENTITY_MISSING };
  }
  const usable = new Set(input.personalIdentities ? uniqueUsableIds(input.personalIdentities) : []);
  const grantIds = new Set<string>();
  for (const grant of input.personalGrants ?? []) {
    if (grant.agentId.trim() !== input.targetAgentId) {
      continue;
    }
    if (grant.status?.trim().toLowerCase() === "revoked") {
      continue;
    }
    const identityId = grant.identityId.trim();
    if (!identityId) {
      continue;
    }
    if (input.personalIdentities && !usable.has(identityId)) {
      continue;
    }
    grantIds.add(identityId);
  }
  const fromGrant = pickSingle([...grantIds]);
  if (fromGrant) {
    return fromGrant;
  }
  if (!input.personalIdentities) {
    return { ok: false, message: DAIBAI_OI_IDENTITY_MISSING };
  }
  return (
    pickSingle(uniqueUsableIds(input.personalIdentities)) ?? {
      ok: false,
      message: DAIBAI_OI_IDENTITY_MISSING,
    }
  );
}

function resolveEnterpriseIdentity(input: {
  enterpriseForAgent: readonly DaibaiOiIdentityRef[] | null;
  enterpriseSeatIdentities: readonly DaibaiOiIdentityRef[] | null;
}): DaibaiOiEnrollmentResolveResult {
  if (input.enterpriseForAgent && input.enterpriseForAgent.length > 0) {
    return (
      pickSingle(uniqueUsableIds(input.enterpriseForAgent)) ?? {
        ok: false,
        message: DAIBAI_OI_IDENTITY_MISSING,
      }
    );
  }
  if (input.enterpriseSeatIdentities) {
    return (
      pickSingle(uniqueUsableIds(input.enterpriseSeatIdentities)) ?? {
        ok: false,
        message: DAIBAI_OI_IDENTITY_MISSING,
      }
    );
  }
  return { ok: false, message: DAIBAI_OI_IDENTITY_MISSING };
}

/**
 * Resolve the oi_enrollment subject from identities already loaded for this employee.
 * Gap keys such as `oi_personal_mail` are not identity ids and are never used here.
 */
export function resolveDaibaiOiEnrollmentIdentity(input: {
  identityScope: "personal" | "enterprise";
  targetAgentId: string;
  context?: DaibaiOiIdentityContext | null;
}): DaibaiOiEnrollmentResolveResult {
  const targetAgentId = input.targetAgentId.trim();
  if (!targetAgentId) {
    return { ok: false, message: DAIBAI_OI_AGENT_MISSING };
  }
  const context = input.context ?? null;
  if (!context) {
    return { ok: false, message: DAIBAI_OI_IDENTITY_MISSING };
  }
  if (input.identityScope === "personal") {
    return resolvePersonalIdentity({
      targetAgentId,
      personalIdentities: context.personalIdentities ?? null,
      personalGrants: context.personalGrants ?? null,
    });
  }
  const byAgent = context.enterpriseIdentitiesByAgent ?? null;
  const enterpriseForAgent = byAgent ? (byAgent[targetAgentId] ?? null) : null;
  return resolveEnterpriseIdentity({
    enterpriseForAgent,
    enterpriseSeatIdentities: context.enterpriseSeatIdentities ?? null,
  });
}

/** Params for enterprise-data.governance-approvals.create. No grant or authorize fields. */
export function buildDaibaiOiEnrollmentCreateParams(
  input: DaibaiOiEnrollmentCreateInput,
): { ok: true; params: Record<string, string> } | { ok: false; message: string } {
  const identityId = input.identityId.trim();
  const targetAgentId = input.targetAgentId.trim();
  if (!targetAgentId) {
    return { ok: false, message: DAIBAI_OI_AGENT_MISSING };
  }
  if (!identityId) {
    return { ok: false, message: DAIBAI_OI_IDENTITY_MISSING };
  }
  const tenantId = input.tenantId?.trim() ?? "";
  const reason = input.reason?.trim() ?? "";
  return {
    ok: true,
    params: {
      ...(tenantId ? { tenantId } : {}),
      category: "oi_enrollment",
      identityScope: input.identityScope,
      identityId,
      targetAgentId,
      catalogId: input.catalogId.trim(),
      templateId: input.templateId.trim(),
      clientRequestId: input.clientRequestId.trim(),
      ...(reason ? { reason } : {}),
    },
  };
}
