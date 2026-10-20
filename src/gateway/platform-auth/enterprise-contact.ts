/**
 * Pure helpers for building a tenant's persistent contact / registration
 * profile (`PlatformAuthEnterprise.contact`).
 *
 * Kept as a leaf module (only depends on request-helpers + store-types) so both
 * the enterprise creation factory and the store backfill can share it without
 * introducing an import cycle through the higher-level provisioning flow.
 */

import { normalizeEmail, normalizeOptionalText } from "./request-helpers.js";
import type {
  PlatformAuthEnterpriseContact,
  PlatformAuthEnterpriseContactSource,
} from "./store-types.js";

/**
 * Build a persistent tenant contact profile, always guaranteeing at least the
 * admin contact so a platform operator can reach the tenant later. Explicitly
 * provided fields win; otherwise contact name/email fall back to the enterprise
 * admin. Empty/whitespace inputs are dropped.
 */
export function buildEnterpriseContact(params: {
  adminName?: string;
  adminEmail?: string;
  contactName?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  companySize?: unknown;
  industry?: unknown;
  source: PlatformAuthEnterpriseContactSource;
  nowIso?: string;
}): PlatformAuthEnterpriseContact {
  const explicitEmail = normalizeEmail(params.contactEmail);
  const adminEmail = normalizeEmail(params.adminEmail);
  const contactEmail = explicitEmail || adminEmail;
  const contactName = normalizeOptionalText(params.contactName, 80) ?? params.adminName?.trim();
  const contactPhone = normalizeOptionalText(params.contactPhone, 40);
  const companySize = normalizeOptionalText(params.companySize, 40);
  const industry = normalizeOptionalText(params.industry, 80);
  return {
    ...(contactName ? { contactName } : {}),
    ...(contactEmail ? { contactEmail } : {}),
    ...(contactPhone ? { contactPhone } : {}),
    ...(companySize ? { companySize } : {}),
    ...(industry ? { industry } : {}),
    source: params.source,
    updatedAt: params.nowIso ?? new Date().toISOString(),
  };
}

/**
 * True when a stored contact carries no actionable way to reach the tenant
 * (no name, email, or phone). Used by the backfill to decide whether an
 * existing enterprise still needs a derived contact.
 */
export function isContactActionable(contact: PlatformAuthEnterpriseContact | undefined): boolean {
  return Boolean(contact && (contact.contactName || contact.contactEmail || contact.contactPhone));
}
