export const CONTROL_UI_ENTERPRISE_DATA_BASE_PATH = "/__openbot/enterprise-data";

export function resolveControlUiEnterpriseDataBasePath(basePath?: string): string {
  const normalizedBasePath = basePath?.trim() || "";
  const suffix = CONTROL_UI_ENTERPRISE_DATA_BASE_PATH;
  return normalizedBasePath ? `${normalizedBasePath}${suffix}` : suffix;
}
