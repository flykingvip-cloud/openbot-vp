/**
 * HTTP Handler for Platform Auth
 *
 * This module contains handleControlUiPlatformAuthRequest and its helper
 * functions extracted from the monolith platform-auth.ts.
 */

// Re-export pure request helpers so the facade's imports keep resolving (Task 5.13).
export {
  assertStrongPassword,
  cleanUrl,
  decideTrialApplyMode,
  isEnterpriseEmail,
  isValidEmail,
  normalizeBoolean,
  normalizeDisplayName,
  normalizeEmail,
  normalizeOptionalText,
  normalizePassword,
  normalizePolicy,
  normalizePositiveInt,
  normalizeTenantName,
  parseExpectedUsers,
  parseRequestBody,
  requiredString,
  requiredStringList,
  toTrialDays,
  toTrialSeats,
} from "./request-helpers.js";
import {
  buildClearedCookieHeader,
  buildCookieHeader,
  canManagePlatform,
  canManagePlatformAdmins,
  clearFailedLoginState,
  createSessionAndReply,
  DEFAULT_PLATFORM_AUTH_SCOPES,
  enqueueLeadNotification,
  findPendingEmployeeProvisionByEmail,
  hasAnyPlatformAdmins,
  hasPendingAdminProvision,
  hasPendingEmployeeProvision,
  purgeOrphanedUserAccount,
  recycleSuspendedOrphanUserByEmail,
  isPlatformSuperAdmin,
  isPlatformUser,
  isUserLocked,
  normalizePlatformAdminScopes,
  PLATFORM_ADMIN_SCOPES,
  platformRoleSatisfiesExpected,
  recordFailedLogin,
  refreshEnterpriseStatuses,
  resolvePlatformRole,
  resolveSessionContext,
  revokePendingEmployeeProvisionsForSeat,
  revokeStalePendingAdminProvisions,
  sendPlatformAuthSuccess,
  toTrustedProxySession,
  hashPassword,
  verifyPassword,
} from "./auth-helpers.js";
// Re-export auth/session helpers so the facade's imports keep resolving (Task 5.13).
export {
  buildClearedCookieHeader,
  buildCookieHeader,
  canManagePlatform,
  canManagePlatformAdmins,
  clearFailedLoginState,
  createSessionAndReply,
  DEFAULT_PLATFORM_AUTH_SCOPES,
  enqueueLeadNotification,
  findPendingEmployeeProvisionByEmail,
  hasAnyPlatformAdmins,
  hasPendingAdminProvision,
  hasPendingEmployeeProvision,
  purgeOrphanedUserAccount,
  recycleSuspendedOrphanUserByEmail,
  isPlatformSuperAdmin,
  isPlatformUser,
  isUserLocked,
  normalizePlatformAdminScopes,
  PLATFORM_ADMIN_SCOPES,
  platformRoleSatisfiesExpected,
  recordFailedLogin,
  refreshEnterpriseStatuses,
  resolvePlatformRole,
  resolveSessionContext,
  revokePendingEmployeeProvisionsForSeat,
  revokeStalePendingAdminProvisions,
  sendPlatformAuthSuccess,
  toTrustedProxySession,
  hashPassword,
  verifyPassword,
} from "./auth-helpers.js";
// Re-export enterprise-provisioning helpers so the facade's imports keep resolving (Task 5.13).
export {
  createEnterpriseWithPendingAdminActivation,
  createPendingAdminActivationForEnterprise,
  normalizeTenantCreationMode,
  slugifyTenant,
  tenantCreationDefaults,
  uniqueSlug,
} from "./enterprise-provisioning.js";
// Re-export enterprise/admin route handlers (extracted to ./routes-enterprise.ts, Task 5.13).
export {
  buildEnterpriseAdminActivationUrl,
  handleEnterpriseAdminActivateRoute,
  handleEnterpriseCreateRoute,
  handlePlatformAdminCreateRoute,
  handlePlatformAdminRemoveRoute,
  handlePlatformEnterpriseAdminActivationSendRoute,
  handlePlatformEnterpriseAdminUpdateRoute,
  handlePlatformEnterpriseCreateRoute,
  resolveEnterpriseAdminActivationOrigin,
} from "./routes-enterprise.js";
// Re-export trial route handlers (extracted to ./routes-trial.ts and ./routes-trial-review.ts, Task 5.13).
export { handleTrialApplyRoute } from "./routes-trial.js";
export {
  handleTrialApplicationApproveRoute,
  handleTrialApplicationRejectRoute,
  handleTrialInstanceUpdateRoute,
  handleTrialPolicyUpdateRoute,
} from "./routes-trial-review.js";
// Re-export employee route handlers (extracted to ./routes-employee*.ts, Task 5.13).
export {
  buildEmployeeActivationUrl,
  createEmployeeProvisionWithSeat,
  handleEmployeeActivationSendRoute,
  handleEmployeeProvisionRoute,
  handleMemberRemoveRoute,
  resolveEmployeeActivationOrigin,
} from "./routes-employee.js";
export {
  handleEmployeeAccessOfferAcceptRoute,
  handleEmployeeAccessOfferDeclineRoute,
  handleEmployeeRegisterRoute,
} from "./routes-employee-register.js";
// Re-export token operations so existing facade imports from http-handler keep resolving (Task 5.9).
export {
  buildPendingCode,
  findLatestActiveCode,
  hashOpaqueCode,
  invalidateUserSessions,
  issueActivationCode,
  nextDisplayCode,
  normalizeActivationStatus,
  pruneExpiredActivationCodes,
  verifyOpaqueCode,
} from "./token-operations.js";
// ============================================================================
// Basic Utility Functions — pure helpers extracted to ./request-helpers.ts (Task 5.13)
// ============================================================================
// ============================================================================
// Auth/session helpers — extracted to ./auth-helpers.ts (Task 5.13)
// ============================================================================
// Enterprise Creation Helper Functions — extracted to ./enterprise-provisioning.ts (Task 5.13)
// ============================================================================
// Trial Application Helper Functions — pure helpers extracted to ./request-helpers.ts (Task 5.13)
// ============================================================================
// Activation Code Helper Functions — extracted to ./token-operations.ts (Task 5.9)
// ============================================================================
// Cookie + session-reply + provision helpers — extracted to ./auth-helpers.ts (Task 5.13)
// ============================================================================
// Route Handlers — extracted to ./routes-{auth,enterprise,employee,employee-register,trial}.ts (Task 5.13)
// ============================================================================

// Re-export auth/session route handlers (extracted to ./routes-auth.ts and ./routes-login-password.ts, Task 5.13).
export {
  handleLogoutRoute,
  handleMfaPolicyRoute,
  handleRetiredRoutes,
  handleSessionRoute,
  handleSessionSwitchRoute,
  handleTrialApplicationsRoute,
} from "./routes-auth.js";
export {
  handleLoginRoute,
  handlePasswordChangeRoute,
  handlePasswordForgotRoute,
  handlePasswordResetRoute,
  handlePlatformBootstrapRoute,
} from "./routes-login-password.js";
