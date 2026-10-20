import type { SecurityProfileStartupAudit } from "./types.js";

/** Redacted startup audit line — no tenant ids, paths, or credentials. */
export function formatSecurityProfileAuditLine(audit: SecurityProfileStartupAudit): string {
  const flags = [
    audit.multitenantAddressing ? "multitenant=on" : "multitenant=off",
    audit.explicitTenantsRoot ? "tenantsRoot=explicit" : "tenantsRoot=default",
    audit.dedicatedSingleTenant ? "singleTenant=server" : "singleTenant=off",
  ].join(" ");
  return `security profile: ${audit.profile} isolation=${audit.isolationLevel} dataMode=${audit.dataMode} ${flags}`;
}

export function logSecurityProfileStartup(params: {
  audit: SecurityProfileStartupAudit;
  log: { info: (msg: string) => void };
}): void {
  params.log.info(formatSecurityProfileAuditLine(params.audit));
}
