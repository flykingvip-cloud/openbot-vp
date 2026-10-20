/**
 * Optional single-owner export of the legacy shared browser profile.
 *
 * The staged pipeline lives in the sandbox account-file transfer module.
 * This re-export keeps the P0 helper name. Default P4 behavior is still a
 * cold empty profile: without single-owner proof nothing is copied.
 */
export {
  exportSingleOwnerBrowserProfile,
  type AccountMigrationOutcome as BrowserProfileMigrationResult,
} from "../agents/sandbox/account-shared-browser-migration.js";
