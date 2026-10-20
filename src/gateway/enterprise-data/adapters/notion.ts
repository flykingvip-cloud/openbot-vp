import type { DataConnectorCredentialSecret } from "../types.js";
import { NOTION_API_VERSION, probeNotionAccessToken } from "./notion-oauth.js";

export async function probeNotionConnection(
  secret: DataConnectorCredentialSecret,
): Promise<{ ok: boolean; message: string }> {
  const token = secret.oauthAccessToken?.trim();
  if (!token) {
    return { ok: false, message: "Notion OAuth 访问令牌缺失。" };
  }
  if (token.startsWith("simulated-notion-token-")) {
    return { ok: true, message: "Notion 模拟 OAuth 凭证有效（开发模式）。" };
  }
  return probeNotionAccessToken(token);
}

export async function executeNotionHandler(
  handlerRef: string,
  secret: DataConnectorCredentialSecret,
): Promise<{ payload: unknown }> {
  const token = secret.oauthAccessToken?.trim();
  if (!token) {
    throw new Error("Notion OAuth access token is required.");
  }
  if (handlerRef === "enterprise-data/handlers/notion-kb-search-v1") {
    if (token.startsWith("simulated-notion-token-")) {
      return {
        payload: {
          pages: [
            { id: "notion-page-demo-1", object: "page" },
            { id: "notion-page-demo-2", object: "page" },
          ],
        },
      };
    }
    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "",
        page_size: 5,
        filter: { value: "page", property: "object" },
      }),
    });
    if (!response.ok) {
      throw new Error(`Notion search failed with status ${response.status}`);
    }
    const body = (await response.json()) as { results?: Array<{ id: string; object: string }> };
    return {
      payload: {
        pages: (body.results ?? []).map((item) => ({
          id: item.id,
          object: item.object,
        })),
      },
    };
  }
  throw new Error(`Notion adapter does not support handler: ${handlerRef}`);
}
