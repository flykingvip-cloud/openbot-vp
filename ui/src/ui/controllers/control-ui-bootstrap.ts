import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  type ControlUiBootstrapConfig,
  type ControlUiAuthMode,
  type ControlUiPlatformAdminSummary,
  type ControlUiPlatformEnterpriseSummary,
  type ControlUiPlatformAuthState,
  type ControlUiPlatformInvite,
  type ControlUiPlatformPendingCode,
  type ControlUiPlatformTrialPolicy,
  type ControlUiTrustedProxySession,
} from "../../../../src/gateway/control-ui-contract.js";
import { normalizeAssistantIdentity } from "../assistant-identity.ts";
import { normalizeBasePath } from "../navigation.ts";

export type ControlUiBootstrapState = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  bootstrapAuthMode: ControlUiAuthMode | null;
  bootstrapAuthSession: ControlUiTrustedProxySession | null;
  platformAuthState: ControlUiPlatformAuthState | null;
  platformModelsMode?: "native" | "aor_enhanced";
  workspaceHost?: ControlUiBootstrapConfig["workspaceHost"] | null;
  bootstrapDataSpace?: ControlUiBootstrapConfig["dataSpace"] | null;
};

function normalizeTrustedProxySession(
  session: ControlUiBootstrapConfig["authSession"],
): ControlUiTrustedProxySession | null {
  if (!session || session.provider !== "trusted-proxy") {
    return null;
  }
  const user = typeof session.user === "string" ? session.user.trim() : "";
  if (!user) {
    return null;
  }
  const scopes = Array.isArray(session.scopes)
    ? session.scopes
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;
  return {
    provider: "trusted-proxy",
    user,
    displayName:
      typeof session.displayName === "string" && session.displayName.trim()
        ? session.displayName.trim()
        : undefined,
    tenantId:
      typeof session.tenantId === "string" && session.tenantId.trim()
        ? session.tenantId.trim()
        : undefined,
    role: typeof session.role === "string" && session.role.trim() ? session.role.trim() : undefined,
    ...(scopes ? { scopes } : {}),
  };
}

export function isCurrentControlUiGatewayTarget(params: {
  gatewayUrl: string;
  pageUrl?: string;
}): boolean {
  const pageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!pageUrl) {
    return false;
  }
  try {
    const page = new URL(pageUrl);
    const gateway = new URL(params.gatewayUrl, page);
    const allowedProtocols = new Set(["ws:", "wss:", "http:", "https:"]);
    const normalizeLoopbackHost = (host: string): string =>
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.startsWith("127.")
        ? "loopback"
        : host;
    return (
      allowedProtocols.has(gateway.protocol) &&
      gateway.port === page.port &&
      normalizeLoopbackHost(gateway.hostname) === normalizeLoopbackHost(page.hostname)
    );
  } catch {
    return false;
  }
}

function normalizePlatformAuthState(
  value: ControlUiBootstrapConfig["platformAuth"],
): ControlUiPlatformAuthState | null {
  if (!value || !value.enabled) {
    return null;
  }
  const latestInvite = (() => {
    if (!value.latestInvite || typeof value.latestInvite.code !== "string") {
      return undefined;
    }
    const code = value.latestInvite.code.trim();
    const expiresAt =
      typeof value.latestInvite.expiresAt === "string" ? value.latestInvite.expiresAt.trim() : "";
    if (!code || !expiresAt) {
      return undefined;
    }
    return {
      code,
      expiresAt,
      tenantId:
        typeof value.latestInvite.tenantId === "string" && value.latestInvite.tenantId.trim()
          ? value.latestInvite.tenantId.trim()
          : undefined,
      tenantName:
        typeof value.latestInvite.tenantName === "string" && value.latestInvite.tenantName.trim()
          ? value.latestInvite.tenantName.trim()
          : undefined,
    } satisfies ControlUiPlatformInvite;
  })();
  const normalizePendingCode = (
    entry: ControlUiPlatformAuthState["pendingActivation"],
  ): ControlUiPlatformPendingCode | undefined => {
    if (!entry || typeof entry.code !== "string" || typeof entry.email !== "string") {
      return undefined;
    }
    const code = entry.code.trim();
    const email = entry.email.trim();
    const expiresAt = typeof entry.expiresAt === "string" ? entry.expiresAt.trim() : "";
    if (!code || !email || !expiresAt) {
      return undefined;
    }
    return {
      kind: entry.kind,
      ...(typeof entry.assignmentId === "string" && entry.assignmentId.trim()
        ? { assignmentId: entry.assignmentId.trim() }
        : {}),
      code,
      email,
      expiresAt,
      enterpriseName:
        typeof entry.enterpriseName === "string" && entry.enterpriseName.trim()
          ? entry.enterpriseName.trim()
          : undefined,
    };
  };
  const normalizeEnterprise = (
    entry: ControlUiPlatformAuthState["enterprise"],
  ): ControlUiPlatformEnterpriseSummary | undefined => {
    if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string") {
      return undefined;
    }
    const id = entry.id.trim();
    const name = entry.name.trim();
    if (!id || !name) {
      return undefined;
    }
    return {
      id,
      name,
      status: entry.status,
      plan: entry.plan,
      billingStatus: entry.billingStatus,
      createdSource: entry.createdSource,
      ...(typeof entry.trialDaysSnapshot === "number" && Number.isFinite(entry.trialDaysSnapshot)
        ? { trialDaysSnapshot: entry.trialDaysSnapshot }
        : {}),
      seatQuota: entry.seatQuota,
      seatUsed: entry.seatUsed,
      seatsRemaining: entry.seatsRemaining,
      ...(typeof entry.trialEndsAt === "string" && entry.trialEndsAt.trim()
        ? { trialEndsAt: entry.trialEndsAt.trim() }
        : {}),
      ...(typeof entry.upgradeUrl === "string" && entry.upgradeUrl.trim()
        ? { upgradeUrl: entry.upgradeUrl.trim() }
        : {}),
      ...(typeof entry.contactAdvisorUrl === "string" && entry.contactAdvisorUrl.trim()
        ? { contactAdvisorUrl: entry.contactAdvisorUrl.trim() }
        : {}),
      ...(typeof entry.allowReadOnlyAfterExpiry === "boolean"
        ? { allowReadOnlyAfterExpiry: entry.allowReadOnlyAfterExpiry }
        : {}),
      ...(entry.usageSummary &&
      typeof entry.usageSummary === "object" &&
      !Array.isArray(entry.usageSummary)
        ? {
            usageSummary: {
              ...(typeof entry.usageSummary.calls7d === "number" &&
              Number.isFinite(entry.usageSummary.calls7d)
                ? { calls7d: entry.usageSummary.calls7d }
                : {}),
              ...(typeof entry.usageSummary.cost7d === "number" &&
              Number.isFinite(entry.usageSummary.cost7d)
                ? { cost7d: entry.usageSummary.cost7d }
                : {}),
              ...(typeof entry.usageSummary.topModelLabel === "string" &&
              entry.usageSummary.topModelLabel.trim()
                ? { topModelLabel: entry.usageSummary.topModelLabel.trim() }
                : {}),
              ...(typeof entry.usageSummary.topAgentLabel === "string" &&
              entry.usageSummary.topAgentLabel.trim()
                ? { topAgentLabel: entry.usageSummary.topAgentLabel.trim() }
                : {}),
              ...(typeof entry.usageSummary.activeAgentCount === "number" &&
              Number.isFinite(entry.usageSummary.activeAgentCount)
                ? { activeAgentCount: entry.usageSummary.activeAgentCount }
                : {}),
              ...(typeof entry.usageSummary.activeChannelCount === "number" &&
              Number.isFinite(entry.usageSummary.activeChannelCount)
                ? { activeChannelCount: entry.usageSummary.activeChannelCount }
                : {}),
              ...(typeof entry.usageSummary.activeRuntimeCount === "number" &&
              Number.isFinite(entry.usageSummary.activeRuntimeCount)
                ? { activeRuntimeCount: entry.usageSummary.activeRuntimeCount }
                : {}),
              ...(Array.isArray(entry.usageSummary.dailyCalls)
                ? {
                    dailyCalls: entry.usageSummary.dailyCalls.filter(
                      (value): value is number =>
                        typeof value === "number" && Number.isFinite(value),
                    ),
                  }
                : {}),
              ...(Array.isArray(entry.usageSummary.dailyCost)
                ? {
                    dailyCost: entry.usageSummary.dailyCost.filter(
                      (value): value is number =>
                        typeof value === "number" && Number.isFinite(value),
                    ),
                  }
                : {}),
              ...(typeof entry.usageSummary.updatedAt === "number" &&
              Number.isFinite(entry.usageSummary.updatedAt)
                ? { updatedAt: entry.usageSummary.updatedAt }
                : {}),
            },
          }
        : {}),
      ...(entry.adoptionSummary &&
      typeof entry.adoptionSummary === "object" &&
      !Array.isArray(entry.adoptionSummary)
        ? {
            adoptionSummary: {
              ...(typeof entry.adoptionSummary.label === "string" &&
              entry.adoptionSummary.label.trim()
                ? { label: entry.adoptionSummary.label.trim() }
                : {}),
              ...(entry.adoptionSummary.tone === "ok" ||
              entry.adoptionSummary.tone === "warn" ||
              entry.adoptionSummary.tone === "danger" ||
              entry.adoptionSummary.tone === "neutral"
                ? { tone: entry.adoptionSummary.tone }
                : {}),
              ...(typeof entry.adoptionSummary.aiActiveUsers === "number" &&
              Number.isFinite(entry.adoptionSummary.aiActiveUsers)
                ? { aiActiveUsers: entry.adoptionSummary.aiActiveUsers }
                : {}),
              ...(typeof entry.adoptionSummary.automationTaskCount === "number" &&
              Number.isFinite(entry.adoptionSummary.automationTaskCount)
                ? { automationTaskCount: entry.adoptionSummary.automationTaskCount }
                : {}),
              ...(typeof entry.adoptionSummary.note === "string" &&
              entry.adoptionSummary.note.trim()
                ? { note: entry.adoptionSummary.note.trim() }
                : {}),
              ...(typeof entry.adoptionSummary.updatedAt === "number" &&
              Number.isFinite(entry.adoptionSummary.updatedAt)
                ? { updatedAt: entry.adoptionSummary.updatedAt }
                : {}),
            },
          }
        : {}),
      ...(entry.healthSummary &&
      typeof entry.healthSummary === "object" &&
      !Array.isArray(entry.healthSummary)
        ? {
            healthSummary: {
              ...(typeof entry.healthSummary.label === "string" && entry.healthSummary.label.trim()
                ? { label: entry.healthSummary.label.trim() }
                : {}),
              ...(entry.healthSummary.tone === "ok" ||
              entry.healthSummary.tone === "warn" ||
              entry.healthSummary.tone === "danger" ||
              entry.healthSummary.tone === "neutral"
                ? { tone: entry.healthSummary.tone }
                : {}),
              ...(typeof entry.healthSummary.incidentLabel === "string" &&
              entry.healthSummary.incidentLabel.trim()
                ? { incidentLabel: entry.healthSummary.incidentLabel.trim() }
                : {}),
              ...(typeof entry.healthSummary.errorRate === "number" &&
              Number.isFinite(entry.healthSummary.errorRate)
                ? { errorRate: entry.healthSummary.errorRate }
                : {}),
              ...(typeof entry.healthSummary.successRate === "number" &&
              Number.isFinite(entry.healthSummary.successRate)
                ? { successRate: entry.healthSummary.successRate }
                : {}),
              ...(typeof entry.healthSummary.fallbackRate === "number" &&
              Number.isFinite(entry.healthSummary.fallbackRate)
                ? { fallbackRate: entry.healthSummary.fallbackRate }
                : {}),
              ...(typeof entry.healthSummary.avgLatencyMs === "number" &&
              Number.isFinite(entry.healthSummary.avgLatencyMs)
                ? { avgLatencyMs: entry.healthSummary.avgLatencyMs }
                : {}),
              ...(typeof entry.healthSummary.updatedAt === "number" &&
              Number.isFinite(entry.healthSummary.updatedAt)
                ? { updatedAt: entry.healthSummary.updatedAt }
                : {}),
            },
          }
        : {}),
      ...(entry.contact && typeof entry.contact === "object" && !Array.isArray(entry.contact)
        ? (() => {
            const contactName =
              typeof entry.contact.contactName === "string" && entry.contact.contactName.trim()
                ? entry.contact.contactName.trim()
                : undefined;
            const contactEmail =
              typeof entry.contact.contactEmail === "string" && entry.contact.contactEmail.trim()
                ? entry.contact.contactEmail.trim()
                : undefined;
            const contactPhone =
              typeof entry.contact.contactPhone === "string" && entry.contact.contactPhone.trim()
                ? entry.contact.contactPhone.trim()
                : undefined;
            const companySize =
              typeof entry.contact.companySize === "string" && entry.contact.companySize.trim()
                ? entry.contact.companySize.trim()
                : undefined;
            const industry =
              typeof entry.contact.industry === "string" && entry.contact.industry.trim()
                ? entry.contact.industry.trim()
                : undefined;
            const source =
              entry.contact.source === "trial-application" ||
              entry.contact.source === "admin-provision" ||
              entry.contact.source === "platform-created" ||
              entry.contact.source === "manual"
                ? entry.contact.source
                : undefined;
            const status =
              entry.contact.status === "pending_activation" || entry.contact.status === "activated"
                ? entry.contact.status
                : undefined;
            const updatedAt =
              typeof entry.contact.updatedAt === "string" && entry.contact.updatedAt.trim()
                ? entry.contact.updatedAt.trim()
                : undefined;
            if (
              !contactName &&
              !contactEmail &&
              !contactPhone &&
              !companySize &&
              !industry &&
              !source &&
              !status &&
              !updatedAt
            ) {
              return {};
            }
            return {
              contact: {
                ...(contactName ? { contactName } : {}),
                ...(contactEmail ? { contactEmail } : {}),
                ...(contactPhone ? { contactPhone } : {}),
                ...(companySize ? { companySize } : {}),
                ...(industry ? { industry } : {}),
                ...(source ? { source } : {}),
                ...(status ? { status } : {}),
                ...(updatedAt ? { updatedAt } : {}),
              },
            };
          })()
        : {}),
    };
  };
  const normalizeTrialPolicy = (
    entry: ControlUiPlatformAuthState["platformPolicy"],
  ): ControlUiPlatformTrialPolicy | undefined => {
    if (!entry) {
      return undefined;
    }
    return {
      defaultTrialDays: entry.defaultTrialDays,
      allowedTrialDays: [...entry.allowedTrialDays],
      defaultTrialSeatCount: entry.defaultTrialSeatCount,
      trialSeatOptions: [...entry.trialSeatOptions],
      allowCustomTrialSeatCount: entry.allowCustomTrialSeatCount,
      trialExpiryPolicy: entry.trialExpiryPolicy,
      ...(typeof entry.upgradeUrl === "string" && entry.upgradeUrl.trim()
        ? { upgradeUrl: entry.upgradeUrl.trim() }
        : {}),
      ...(typeof entry.contactAdvisorUrl === "string" && entry.contactAdvisorUrl.trim()
        ? { contactAdvisorUrl: entry.contactAdvisorUrl.trim() }
        : {}),
    };
  };
  const normalizeOrganization = (
    entry: ControlUiPlatformAuthState["organization"],
  ): ControlUiPlatformAuthState["organization"] | undefined => {
    if (!entry) {
      return undefined;
    }
    return {
      seatCount: entry.seatCount,
      occupiedSeatCount: entry.occupiedSeatCount,
      ...(typeof entry.assignedSeatCount === "number" && Number.isFinite(entry.assignedSeatCount)
        ? { assignedSeatCount: entry.assignedSeatCount }
        : {}),
      vacantSeatCount: entry.vacantSeatCount,
      handoverSeatCount: entry.handoverSeatCount,
      frozenSeatCount: entry.frozenSeatCount,
      pendingOfferCount: entry.pendingOfferCount,
      seats: Array.isArray(entry.seats)
        ? entry.seats
            .map((seat) => {
              const seatId = typeof seat?.seatId === "string" ? seat.seatId.trim() : "";
              const title = typeof seat?.title === "string" ? seat.title.trim() : "";
              if (!seatId || !title) {
                return null;
              }
              return {
                seatId,
                title,
                ...(typeof seat?.teamLabel === "string" && seat.teamLabel.trim()
                  ? { teamLabel: seat.teamLabel.trim() }
                  : {}),
                ...(typeof seat?.responsibility === "string" && seat.responsibility.trim()
                  ? { responsibility: seat.responsibility.trim() }
                  : {}),
                ...(typeof seat?.roleCode === "string" && seat.roleCode.trim()
                  ? { roleCode: seat.roleCode.trim() }
                  : {}),
                status: seat.status,
                ...(typeof seat?.currentEmployeeUser === "string" && seat.currentEmployeeUser.trim()
                  ? { currentEmployeeUser: seat.currentEmployeeUser.trim() }
                  : {}),
                ...(typeof seat?.currentEmployeeDisplayName === "string" &&
                seat.currentEmployeeDisplayName.trim()
                  ? { currentEmployeeDisplayName: seat.currentEmployeeDisplayName.trim() }
                  : {}),
                ...(typeof seat?.pendingEmployeeUser === "string" && seat.pendingEmployeeUser.trim()
                  ? { pendingEmployeeUser: seat.pendingEmployeeUser.trim() }
                  : {}),
                ...(typeof seat?.pendingEmployeeDisplayName === "string" &&
                seat.pendingEmployeeDisplayName.trim()
                  ? { pendingEmployeeDisplayName: seat.pendingEmployeeDisplayName.trim() }
                  : {}),
                ...(typeof seat?.pendingAssignmentId === "string" && seat.pendingAssignmentId.trim()
                  ? { pendingAssignmentId: seat.pendingAssignmentId.trim() }
                  : {}),
                ...(typeof seat?.pendingActivationExpiresAt === "string" &&
                seat.pendingActivationExpiresAt.trim()
                  ? { pendingActivationExpiresAt: seat.pendingActivationExpiresAt.trim() }
                  : {}),
                ...(typeof seat?.defaultAgentId === "string" && seat.defaultAgentId.trim()
                  ? { defaultAgentId: seat.defaultAgentId.trim() }
                  : {}),
                ...(Array.isArray(seat?.agentIds)
                  ? {
                      agentIds: seat.agentIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(seat?.defaultSpaceIds)
                  ? {
                      defaultSpaceIds: seat.defaultSpaceIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(seat?.memoryScopeIds)
                  ? {
                      memoryScopeIds: seat.memoryScopeIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(seat?.memoryScopes)
                  ? {
                      memoryScopes: seat.memoryScopes.flatMap((entry) => {
                        const scopeId =
                          typeof entry?.scopeId === "string" ? entry.scopeId.trim() : "";
                        const transferClass =
                          entry?.transferClass === "inheritable" ||
                          entry?.transferClass === "review_required" ||
                          entry?.transferClass === "private"
                            ? entry.transferClass
                            : null;
                        return scopeId && transferClass ? [{ scopeId, transferClass }] : [];
                      }),
                    }
                  : {}),
                ...(Array.isArray(seat?.connectorIds)
                  ? {
                      connectorIds: seat.connectorIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(seat?.connectorProfiles)
                  ? {
                      connectorProfiles: seat.connectorProfiles.flatMap((entry) => {
                        const profileId =
                          typeof entry?.profileId === "string" ? entry.profileId.trim() : "";
                        if (!profileId) {
                          return [];
                        }
                        return [
                          {
                            profileId,
                            credentialReauthorizationRequired:
                              entry?.credentialReauthorizationRequired,
                          },
                        ];
                      }),
                    }
                  : {}),
                ...(seat?.activeBindingStatus
                  ? { activeBindingStatus: seat.activeBindingStatus }
                  : {}),
              };
            })
            .filter((seat): seat is NonNullable<typeof seat> => seat !== null)
        : [],
      handovers: Array.isArray(entry.handovers)
        ? entry.handovers
            .map((handover) => {
              const handoverCaseId =
                typeof handover?.handoverCaseId === "string" ? handover.handoverCaseId.trim() : "";
              const seatId = typeof handover?.seatId === "string" ? handover.seatId.trim() : "";
              const seatTitle =
                typeof handover?.seatTitle === "string" ? handover.seatTitle.trim() : "";
              const createdAt =
                typeof handover?.createdAt === "string" ? handover.createdAt.trim() : "";
              if (!handoverCaseId || !seatId || !seatTitle || !createdAt) {
                return null;
              }
              return {
                handoverCaseId,
                seatId,
                seatTitle,
                status: handover.status,
                createdAt,
                ...(typeof handover?.outgoingEmployeeUser === "string" &&
                handover.outgoingEmployeeUser.trim()
                  ? { outgoingEmployeeUser: handover.outgoingEmployeeUser.trim() }
                  : {}),
                ...(typeof handover?.incomingEmployeeUser === "string" &&
                handover.incomingEmployeeUser.trim()
                  ? { incomingEmployeeUser: handover.incomingEmployeeUser.trim() }
                  : {}),
                ...(typeof handover?.completedAt === "string" && handover.completedAt.trim()
                  ? { completedAt: handover.completedAt.trim() }
                  : {}),
              };
            })
            .filter((handover): handover is NonNullable<typeof handover> => handover !== null)
        : [],
      offers: Array.isArray(entry.offers)
        ? entry.offers
            .map((offer) => {
              const offerId = typeof offer?.offerId === "string" ? offer.offerId.trim() : "";
              const seatId = typeof offer?.seatId === "string" ? offer.seatId.trim() : "";
              const seatTitle = typeof offer?.seatTitle === "string" ? offer.seatTitle.trim() : "";
              const targetEmployeeUser =
                typeof offer?.targetEmployeeUser === "string"
                  ? offer.targetEmployeeUser.trim()
                  : "";
              const offeredAt = typeof offer?.offeredAt === "string" ? offer.offeredAt.trim() : "";
              if (!offerId || !seatId || !seatTitle || !targetEmployeeUser || !offeredAt) {
                return null;
              }
              return {
                ...(typeof offer?.assignmentId === "string" && offer.assignmentId.trim()
                  ? { assignmentId: offer.assignmentId.trim() }
                  : {}),
                offerId,
                seatId,
                seatTitle,
                targetEmployeeUser,
                status: offer.status,
                offeredAt,
                ...(typeof offer?.defaultAgentId === "string" && offer.defaultAgentId.trim()
                  ? { defaultAgentId: offer.defaultAgentId.trim() }
                  : {}),
                ...(Array.isArray(offer?.agentIds)
                  ? {
                      agentIds: offer.agentIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(offer?.defaultSpaceIds)
                  ? {
                      defaultSpaceIds: offer.defaultSpaceIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(offer?.memoryScopeIds)
                  ? {
                      memoryScopeIds: offer.memoryScopeIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(offer?.memoryScopes)
                  ? {
                      memoryScopes: offer.memoryScopes.flatMap((entry) => {
                        const scopeId =
                          typeof entry?.scopeId === "string" ? entry.scopeId.trim() : "";
                        const transferClass =
                          entry?.transferClass === "inheritable" ||
                          entry?.transferClass === "review_required" ||
                          entry?.transferClass === "private"
                            ? entry.transferClass
                            : null;
                        return scopeId && transferClass ? [{ scopeId, transferClass }] : [];
                      }),
                    }
                  : {}),
                ...(Array.isArray(offer?.connectorIds)
                  ? {
                      connectorIds: offer.connectorIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(offer?.connectorProfileIds)
                  ? {
                      connectorProfileIds: offer.connectorProfileIds
                        .filter((value): value is string => typeof value === "string")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
                ...(Array.isArray(offer?.connectorProfiles)
                  ? {
                      connectorProfiles: offer.connectorProfiles.flatMap((entry) => {
                        const profileId =
                          typeof entry?.profileId === "string" ? entry.profileId.trim() : "";
                        if (!profileId) {
                          return [];
                        }
                        return [
                          {
                            profileId,
                            credentialReauthorizationRequired:
                              entry?.credentialReauthorizationRequired,
                          },
                        ];
                      }),
                    }
                  : {}),
                ...(typeof offer?.connectorCredentialReauthorizationRequired === "boolean"
                  ? {
                      connectorCredentialReauthorizationRequired:
                        offer.connectorCredentialReauthorizationRequired,
                    }
                  : {}),
                ...(typeof offer?.reauthorizationRequired === "boolean"
                  ? { reauthorizationRequired: offer.reauthorizationRequired }
                  : {}),
                ...(typeof offer?.expiresAt === "string" && offer.expiresAt.trim()
                  ? { expiresAt: offer.expiresAt.trim() }
                  : {}),
                ...(typeof offer?.handoverCaseId === "string" && offer.handoverCaseId.trim()
                  ? { handoverCaseId: offer.handoverCaseId.trim() }
                  : {}),
              };
            })
            .filter((offer): offer is NonNullable<typeof offer> => offer !== null)
        : [],
    };
  };
  const normalizeEmployeeAccess = (
    entry: ControlUiPlatformAuthState["employeeAccess"],
  ): ControlUiPlatformAuthState["employeeAccess"] | undefined => {
    if (!entry) {
      return undefined;
    }
    return {
      ...(entry.currentSeat &&
      typeof entry.currentSeat.seatId === "string" &&
      entry.currentSeat.seatId.trim() &&
      typeof entry.currentSeat.title === "string" &&
      entry.currentSeat.title.trim()
        ? {
            currentSeat: {
              seatId: entry.currentSeat.seatId.trim(),
              title: entry.currentSeat.title.trim(),
              status: entry.currentSeat.status,
              bindingStatus: entry.currentSeat.bindingStatus,
            },
          }
        : entry.currentSeat === null
          ? { currentSeat: null }
          : {}),
      ...(typeof entry.defaultAgentId === "string" && entry.defaultAgentId.trim()
        ? { defaultAgentId: entry.defaultAgentId.trim() }
        : entry.defaultAgentId === null
          ? { defaultAgentId: null }
          : {}),
      ...(Array.isArray(entry.agentIds)
        ? {
            agentIds: entry.agentIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(Array.isArray(entry.ownedAgentIds)
        ? {
            ownedAgentIds: entry.ownedAgentIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(typeof entry.employeeUserId === "string" && entry.employeeUserId.trim()
        ? { employeeUserId: entry.employeeUserId.trim() }
        : {}),
      ...(Array.isArray(entry.defaultSpaceIds)
        ? {
            defaultSpaceIds: entry.defaultSpaceIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(Array.isArray(entry.memoryScopeIds)
        ? {
            memoryScopeIds: entry.memoryScopeIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(Array.isArray(entry.connectorIds)
        ? {
            connectorIds: entry.connectorIds
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(entry.pendingOffer &&
      typeof entry.pendingOffer.offerId === "string" &&
      entry.pendingOffer.offerId.trim()
        ? {
            pendingOffer: {
              ...(typeof entry.pendingOffer.assignmentId === "string" &&
              entry.pendingOffer.assignmentId.trim()
                ? { assignmentId: entry.pendingOffer.assignmentId.trim() }
                : {}),
              ...(entry.pendingOffer.assignmentType === "new_hire" ||
              entry.pendingOffer.assignmentType === "internal"
                ? { assignmentType: entry.pendingOffer.assignmentType }
                : {}),
              offerId: entry.pendingOffer.offerId.trim(),
              seatId: entry.pendingOffer.seatId.trim(),
              seatTitle: entry.pendingOffer.seatTitle.trim(),
              offeredAt: entry.pendingOffer.offeredAt.trim(),
              ...(typeof entry.pendingOffer.defaultAgentId === "string" &&
              entry.pendingOffer.defaultAgentId.trim()
                ? { defaultAgentId: entry.pendingOffer.defaultAgentId.trim() }
                : entry.pendingOffer.defaultAgentId === null
                  ? { defaultAgentId: null }
                  : {}),
              ...(Array.isArray(entry.pendingOffer.agentIds)
                ? {
                    agentIds: entry.pendingOffer.agentIds
                      .filter((value): value is string => typeof value === "string")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.omittedAgentIds)
                ? {
                    omittedAgentIds: entry.pendingOffer.omittedAgentIds
                      .filter((value): value is string => typeof value === "string")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.defaultSpaceIds)
                ? {
                    defaultSpaceIds: entry.pendingOffer.defaultSpaceIds
                      .filter((value): value is string => typeof value === "string")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.memoryScopeIds)
                ? {
                    memoryScopeIds: entry.pendingOffer.memoryScopeIds
                      .filter((value): value is string => typeof value === "string")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.memoryScopes)
                ? {
                    memoryScopes: entry.pendingOffer.memoryScopes.flatMap((scope) => {
                      const scopeId =
                        typeof scope?.scopeId === "string" ? scope.scopeId.trim() : "";
                      const transferClass =
                        scope?.transferClass === "inheritable" ||
                        scope?.transferClass === "review_required" ||
                        scope?.transferClass === "private"
                          ? scope.transferClass
                          : null;
                      return scopeId && transferClass ? [{ scopeId, transferClass }] : [];
                    }),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.connectorIds)
                ? {
                    connectorIds: entry.pendingOffer.connectorIds
                      .filter((value): value is string => typeof value === "string")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.connectorProfileIds)
                ? {
                    connectorProfileIds: entry.pendingOffer.connectorProfileIds
                      .filter((value): value is string => typeof value === "string")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(Array.isArray(entry.pendingOffer.connectorProfiles)
                ? {
                    connectorProfiles: entry.pendingOffer.connectorProfiles.flatMap((profile) => {
                      const profileId =
                        typeof profile?.profileId === "string" ? profile.profileId.trim() : "";
                      if (!profileId) {
                        return [];
                      }
                      return [
                        {
                          profileId,
                          credentialReauthorizationRequired:
                            profile?.credentialReauthorizationRequired,
                        },
                      ];
                    }),
                  }
                : {}),
              ...(typeof entry.pendingOffer.connectorCredentialReauthorizationRequired === "boolean"
                ? {
                    connectorCredentialReauthorizationRequired:
                      entry.pendingOffer.connectorCredentialReauthorizationRequired,
                  }
                : {}),
              ...(typeof entry.pendingOffer.reauthorizationRequired === "boolean"
                ? { reauthorizationRequired: entry.pendingOffer.reauthorizationRequired }
                : {}),
              ...(typeof entry.pendingOffer.expiresAt === "string" &&
              entry.pendingOffer.expiresAt.trim()
                ? { expiresAt: entry.pendingOffer.expiresAt.trim() }
                : {}),
              ...(typeof entry.pendingOffer.handoverCaseId === "string" &&
              entry.pendingOffer.handoverCaseId.trim()
                ? { handoverCaseId: entry.pendingOffer.handoverCaseId.trim() }
                : {}),
            },
          }
        : entry.pendingOffer === null
          ? { pendingOffer: null }
          : {}),
      ...(typeof entry.notice === "string"
        ? { notice: entry.notice }
        : entry.notice === null
          ? { notice: null }
          : {}),
    };
  };
  const members = Array.isArray(value.members)
    ? value.members
        .map((member) => {
          const user = typeof member?.user === "string" ? member.user.trim() : "";
          if (!user) {
            return null;
          }
          return {
            user,
            displayName:
              typeof member?.displayName === "string" && member.displayName.trim()
                ? member.displayName.trim()
                : undefined,
            membershipRole:
              member?.membershipRole === "enterprise-admin" || member?.membershipRole === "member"
                ? member.membershipRole
                : "member",
            joinedAt:
              typeof member?.joinedAt === "string" && member.joinedAt.trim()
                ? member.joinedAt.trim()
                : undefined,
            ...(member?.isCurrentUser ? { isCurrentUser: true } : {}),
          };
        })
        .filter((member): member is NonNullable<typeof member> => member !== null)
    : undefined;
  const platformAdmins = Array.isArray(value.platformAdmins)
    ? value.platformAdmins
        .map((admin): ControlUiPlatformAdminSummary | null => {
          const user = typeof admin?.user === "string" ? admin.user.trim() : "";
          if (!user) {
            return null;
          }
          const platformRole =
            admin?.platformRole === "super-admin" || admin?.platformRole === "admin"
              ? admin.platformRole
              : "admin";
          const scopes = Array.isArray(admin?.scopes)
            ? admin.scopes
                .filter((scope): scope is string => typeof scope === "string")
                .map((scope) => scope.trim())
                .filter(Boolean)
            : undefined;
          return {
            user,
            displayName:
              typeof admin?.displayName === "string" && admin.displayName.trim()
                ? admin.displayName.trim()
                : undefined,
            platformRole,
            status: admin?.status === "suspended" ? "suspended" : "active",
            ...(scopes && scopes.length > 0 ? { scopes } : {}),
            ...(typeof admin?.joinedAt === "string" && admin.joinedAt.trim()
              ? { joinedAt: admin.joinedAt.trim() }
              : {}),
            ...(admin?.isCurrentUser ? { isCurrentUser: true } : {}),
          };
        })
        .filter((admin): admin is ControlUiPlatformAdminSummary => admin !== null)
    : undefined;
  return {
    enabled: true,
    hasUsers: Boolean(value.hasUsers),
    ...(typeof value.hasPlatformAdmins === "boolean"
      ? { hasPlatformAdmins: value.hasPlatformAdmins }
      : {}),
    ...(typeof value.allowRegistration === "boolean"
      ? { allowRegistration: value.allowRegistration }
      : {}),
    ...(value.requiresInvite ? { requiresInvite: true } : {}),
    ...(typeof value.requiresPlatformBootstrap === "boolean"
      ? { requiresPlatformBootstrap: value.requiresPlatformBootstrap }
      : {}),
    ...(typeof value.smtpConfigured === "boolean" ? { smtpConfigured: value.smtpConfigured } : {}),
    ...(Array.isArray(value.availableModes) ? { availableModes: [...value.availableModes] } : {}),
    ...(value.sessionKind ? { sessionKind: value.sessionKind } : {}),
    ...(value.sessionDomain === "platform" ||
    value.sessionDomain === "enterprise" ||
    value.sessionDomain === "employee"
      ? { sessionDomain: value.sessionDomain }
      : {}),
    ...(value.platformRole === "super-admin" || value.platformRole === "admin"
      ? { platformRole: value.platformRole }
      : {}),
    ...(typeof value.tenantName === "string" && value.tenantName.trim()
      ? { tenantName: value.tenantName.trim() }
      : {}),
    ...(value.membershipRole === "enterprise-admin" || value.membershipRole === "member"
      ? { membershipRole: value.membershipRole }
      : {}),
    ...(value.canManageInvites ? { canManageInvites: true } : {}),
    ...(value.canManagePlatform ? { canManagePlatform: true } : {}),
    ...(value.canManagePlatformAdmins ? { canManagePlatformAdmins: true } : {}),
    ...(latestInvite ? { latestInvite } : {}),
    ...(normalizeEnterprise(value.enterprise)
      ? { enterprise: normalizeEnterprise(value.enterprise) }
      : {}),
    ...(normalizeTrialPolicy(value.platformPolicy)
      ? { platformPolicy: normalizeTrialPolicy(value.platformPolicy) }
      : {}),
    ...(normalizeOrganization(value.organization)
      ? { organization: normalizeOrganization(value.organization) }
      : {}),
    ...(normalizeEmployeeAccess(value.employeeAccess)
      ? { employeeAccess: normalizeEmployeeAccess(value.employeeAccess) }
      : {}),
    ...(Array.isArray(value.platformEnterprises)
      ? {
          platformEnterprises: value.platformEnterprises
            .map((entry) => normalizeEnterprise(entry))
            .filter((entry): entry is ControlUiPlatformEnterpriseSummary => Boolean(entry)),
        }
      : {}),
    ...(platformAdmins ? { platformAdmins } : {}),
    ...(normalizePendingCode(value.pendingActivation)
      ? { pendingActivation: normalizePendingCode(value.pendingActivation) }
      : {}),
    ...(normalizePendingCode(value.pendingPasswordReset)
      ? { pendingPasswordReset: normalizePendingCode(value.pendingPasswordReset) }
      : {}),
    ...(value.session ? { session: normalizeTrustedProxySession(value.session) ?? undefined } : {}),
    ...(members && members.length > 0 ? { members } : {}),
  };
}

export async function loadControlUiBootstrapConfig(state: ControlUiBootstrapState) {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof fetch !== "function") {
    return;
  }

  const basePath = normalizeBasePath(state.basePath ?? "");
  const url = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      return;
    }
    const parsed = (await res.json()) as ControlUiBootstrapConfig;
    const normalized = normalizeAssistantIdentity({
      agentId: parsed.assistantAgentId ?? null,
      name: parsed.assistantName,
      avatar: parsed.assistantAvatar ?? null,
    });
    state.assistantName = normalized.name;
    state.assistantAvatar = normalized.avatar;
    state.assistantAgentId = normalized.agentId ?? null;
    state.serverVersion = parsed.serverVersion ?? null;
    state.bootstrapAuthMode = parsed.authMode ?? null;
    state.platformAuthState = normalizePlatformAuthState(parsed.platformAuth);
    state.bootstrapAuthSession =
      normalizeTrustedProxySession(parsed.authSession) ??
      normalizeTrustedProxySession(state.platformAuthState?.session) ??
      null;
    const mode = parsed.platformModels?.mode;
    if (mode === "native" || mode === "aor_enhanced") {
      state.platformModelsMode = mode;
    }
    if (
      parsed.workspaceHost &&
      typeof parsed.workspaceHost.platform === "string" &&
      typeof parsed.workspaceHost.homedir === "string"
    ) {
      state.workspaceHost = {
        platform: parsed.workspaceHost.platform,
        homedir: parsed.workspaceHost.homedir,
        supportsNativeDirectoryChooser: Boolean(
          parsed.workspaceHost.supportsNativeDirectoryChooser,
        ),
      };
    }
    if (
      parsed.dataSpace &&
      (parsed.dataSpace.mode === "local" || parsed.dataSpace.mode === "managed")
    ) {
      state.bootstrapDataSpace = {
        mode: parsed.dataSpace.mode,
        ...(typeof parsed.dataSpace.displayRoot === "string" && parsed.dataSpace.displayRoot.trim()
          ? { displayRoot: parsed.dataSpace.displayRoot.trim() }
          : {}),
      };
    }
  } catch {
    // Ignore bootstrap failures; UI will update identity after connecting.
  }
}
