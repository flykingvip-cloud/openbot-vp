import type { GatewayBrowserClient } from "../../gateway.ts";

export type UserModelingProfileView = {
  preferredReplyLanguage: string | null;
  preferredOutputFormat: string;
  preferredTone: string;
  confirmationPreference: string;
  verbosity: string;
  observations: Record<string, number>;
};

export type UserModelingProfileResponse = {
  userKeyHash: string;
  tenantId: string | null;
  profile: UserModelingProfileView;
};

export async function fetchUserModelingProfile(
  client: GatewayBrowserClient,
): Promise<UserModelingProfileResponse | null> {
  try {
    return await client.request<UserModelingProfileResponse>("user-modeling.get-profile", {});
  } catch {
    return null;
  }
}

export async function resetUserModelingProfile(client: GatewayBrowserClient): Promise<boolean> {
  try {
    const result = await client.request<{ ok?: boolean }>("user-modeling.reset-profile", {});
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}
