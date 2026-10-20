function resolveEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return defaultValue;
}

/** History-to-Context compilation. Default on; set OPENBOT_CONTEXT_COMPILER=0 to disable. */
export function isContextCompilerEnabled(): boolean {
  return resolveEnvBool("OPENBOT_CONTEXT_COMPILER", true);
}
