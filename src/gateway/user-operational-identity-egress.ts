const DEFAULT_EGRESS_IP_URL = "https://api.ipify.org?format=json";
const DEFAULT_TIMEOUT_MS = 5_000;

export async function resolveUserOperationalIdentityGatewayEgressIp(params?: {
  fetchImpl?: typeof fetch;
  url?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const fetchImpl = params?.fetchImpl ?? fetch;
  const url = params?.url?.trim() || DEFAULT_EGRESS_IP_URL;
  const timeoutMs = params?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { ip?: unknown };
      return typeof payload.ip === "string" && payload.ip.trim() ? payload.ip.trim() : null;
    }
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}
