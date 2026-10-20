import { http } from '@kit.NetworkKit';
import { EMPLOYEE_OVERVIEW_PATH, MOBILE_SHELL_QUERY } from '../common/OpenBotConfig';
import { PlatformAuthApi } from '../platformauth/PlatformAuthApi';
import { httpRequest } from '../platformauth/HttpUtil';
import { jsonBoolTrue, jsonString, parseJsonMap } from '../platformauth/JsonHelp';

export const NATIVE_BOOTSTRAP_MINT_PATH: string = '/native/bootstrap/mint';
export const NATIVE_BOOTSTRAP_PATH: string = '/native/bootstrap';

export class BootstrapOutcome {
  ok: boolean = false;
  url: string = '';
  message: string = '';
}

export function withMobileShellMarker(target: string): string {
  if (target.includes(MOBILE_SHELL_QUERY)) {
    return target;
  }
  if (target.includes('?')) {
    return `${target}&${MOBILE_SHELL_QUERY}`;
  }
  return `${target}?${MOBILE_SHELL_QUERY}`;
}

export function defaultEmployeeTarget(): string {
  return withMobileShellMarker(EMPLOYEE_OVERVIEW_PATH);
}

export function buildBootstrapUrl(gatewayBaseUrl: string, token: string, target: string): string {
  const base = gatewayBaseUrl.replace(/\/+$/, '');
  const params = `token=${encodeURIComponent(token)}&target=${encodeURIComponent(target)}`;
  return `${base}${NATIVE_BOOTSTRAP_PATH}?${params}`;
}

export function buildMintUrl(gatewayBaseUrl: string, target: string): string {
  const base = gatewayBaseUrl.replace(/\/+$/, '');
  return `${base}${NATIVE_BOOTSTRAP_MINT_PATH}?target=${encodeURIComponent(target)}`;
}

export async function resolveBootstrapLoadUrl(
  gatewayBaseUrl: string,
  platformSessionCookie: string,
  target?: string,
): Promise<BootstrapOutcome> {
  const outcome = new BootstrapOutcome();
  const rawTarget = (target !== undefined && target.length > 0) ? target : defaultEmployeeTarget();
  const markedTarget = withMobileShellMarker(rawTarget);
  try {
    const url = buildMintUrl(gatewayBaseUrl, markedTarget);
    const cookieHeader = PlatformAuthApi.cookieHeader(platformSessionCookie);
    const response = await httpRequest(url, http.RequestMethod.POST, '', cookieHeader);
    if (response.statusCode === 401) {
      outcome.message = '平台会话已失效，请重新登录';
      return outcome;
    }
    const json = parseJsonMap(response.body);
    const ok = jsonBoolTrue(json, 'ok');
    const token = jsonString(json, 'token').trim();
    if (!ok || token.length === 0) {
      outcome.message = '无法获取 WebView 引导令牌';
      return outcome;
    }
    outcome.ok = true;
    outcome.url = buildBootstrapUrl(gatewayBaseUrl, token, markedTarget);
    return outcome;
  } catch {
    outcome.message = '网络错误或网关不可达';
    return outcome;
  }
}
