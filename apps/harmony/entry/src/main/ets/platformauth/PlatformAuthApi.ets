import { http } from '@kit.NetworkKit';
import {
  PLATFORM_SESSION_COOKIE_NAME,
  PlatformAuthLoginResult,
  PlatformAuthOutcome,
  PlatformAuthSession,
} from './PlatformAuthTypes';
import { extractPlatformSessionCookie, httpRequest } from './HttpUtil';
import { JsonMap, jsonBoolTrue, jsonObject, jsonString, parseJsonMap } from './JsonHelp';

class LoginBody {
  email: string = '';
  password: string = '';
}

class LoginBodyWithMfa {
  email: string = '';
  password: string = '';
  mfaCode: string = '';
}

class RegisterBody {
  email: string = '';
  password: string = '';
  displayName: string = '';
  code: string = '';
}

class ForgotBody {
  email: string = '';
}

class ResetBody {
  email: string = '';
  password: string = '';
  code: string = '';
}

class ChangePasswordBody {
  currentPassword: string = '';
  newPassword: string = '';
}

function buildPlatformAuthUrl(gatewayBaseUrl: string, authPath: string): string {
  const base = gatewayBaseUrl.replace(/\/+$/, '');
  const suffix = authPath.startsWith('/') ? authPath : `/${authPath}`;
  return `${base}/__openbot/platform-auth${suffix}`;
}

function parseSession(json: JsonMap): PlatformAuthSession {
  const session = new PlatformAuthSession();
  const root = jsonObject(json, 'session');
  const platformAuth = jsonObject(json, 'platformAuth');
  const nested = platformAuth ? jsonObject(platformAuth, 'session') : undefined;
  const sessionObj: JsonMap = root ?? nested ?? ({} as JsonMap);
  const email = jsonString(sessionObj, 'email') || jsonString(sessionObj, 'user');
  session.email = email;
  session.displayName =
    jsonString(sessionObj, 'displayName') || jsonString(sessionObj, 'name') || email;
  session.userId = jsonString(sessionObj, 'userId') || jsonString(sessionObj, 'id') || email;
  return session;
}

function pendingResetFromJson(json: JsonMap): string {
  const platformAuth = jsonObject(json, 'platformAuth');
  if (!platformAuth) {
    return '';
  }
  const pending = jsonObject(platformAuth, 'pendingPasswordReset');
  if (!pending) {
    return '';
  }
  return jsonString(pending, 'code').trim();
}

function fail(statusCode: number, code: string, message: string): PlatformAuthOutcome {
  const outcome = new PlatformAuthOutcome();
  outcome.ok = false;
  outcome.statusCode = statusCode;
  outcome.code = code;
  outcome.message = message;
  return outcome;
}

function successFrom(responseStatus: number, body: string, requireCookie: boolean): PlatformAuthOutcome {
  const json = parseJsonMap(body);
  if (!(responseStatus >= 200 && responseStatus < 300 && jsonBoolTrue(json, 'ok'))) {
    return fail(
      responseStatus,
      jsonString(json, 'code'),
      jsonString(json, 'error').trim() || jsonString(json, 'message').trim() || `请求失败（${responseStatus}）`,
    );
  }
  const result = new PlatformAuthLoginResult();
  result.session = parseSession(json);
  // Cookie is filled by caller from HttpResponse.setCookie
  result.pendingResetCode = pendingResetFromJson(json);
  const outcome = new PlatformAuthOutcome();
  outcome.ok = true;
  outcome.statusCode = responseStatus;
  outcome.result = result;
  outcome.message = jsonString(json, 'message').trim();
  if (requireCookie) {
    // Cookie attached by postJson
  }
  return outcome;
}

async function postJson(
  gatewayBaseUrl: string,
  authPath: string,
  bodyText: string,
  requireCookie: boolean,
): Promise<PlatformAuthOutcome> {
  try {
    const url = buildPlatformAuthUrl(gatewayBaseUrl, authPath);
    const response = await httpRequest(url, http.RequestMethod.POST, bodyText);
    const outcome = successFrom(response.statusCode, response.body, requireCookie);
    if (!outcome.ok) {
      return outcome;
    }
    outcome.result.cookieValue = extractPlatformSessionCookie(response.setCookie);
    if (requireCookie && outcome.result.cookieValue.length === 0) {
      return fail(response.statusCode, 'missing_cookie', '登录成功但未收到会话 Cookie');
    }
    return outcome;
  } catch {
    return fail(-1, 'network', '网络错误或网关不可达');
  }
}

export class PlatformAuthApi {
  static async login(
    gatewayBaseUrl: string,
    email: string,
    password: string,
    mfaCode?: string,
  ): Promise<PlatformAuthOutcome> {
    if (mfaCode !== undefined && mfaCode.trim().length > 0) {
      const payload = new LoginBodyWithMfa();
      payload.email = email.trim();
      payload.password = password;
      payload.mfaCode = mfaCode.trim();
      return postJson(gatewayBaseUrl, '/login', JSON.stringify(payload), true);
    }
    const payload = new LoginBody();
    payload.email = email.trim();
    payload.password = password;
    return postJson(gatewayBaseUrl, '/login', JSON.stringify(payload), true);
  }

  static async register(
    gatewayBaseUrl: string,
    email: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ): Promise<PlatformAuthOutcome> {
    const payload = new RegisterBody();
    payload.email = email.trim();
    payload.password = password;
    payload.displayName = displayName.trim();
    payload.code = inviteCode.trim();
    return postJson(gatewayBaseUrl, '/employee/register', JSON.stringify(payload), true);
  }

  static async forgotPassword(
    gatewayBaseUrl: string,
    email: string,
  ): Promise<PlatformAuthOutcome> {
    const payload = new ForgotBody();
    payload.email = email.trim();
    return postJson(gatewayBaseUrl, '/password/forgot', JSON.stringify(payload), false);
  }

  static async resetPassword(
    gatewayBaseUrl: string,
    email: string,
    password: string,
    code: string,
  ): Promise<PlatformAuthOutcome> {
    const payload = new ResetBody();
    payload.email = email.trim();
    payload.password = password;
    payload.code = code.trim();
    return postJson(gatewayBaseUrl, '/password/reset', JSON.stringify(payload), true);
  }

  static async logout(gatewayBaseUrl: string, cookieValue: string): Promise<void> {
    try {
      const url = buildPlatformAuthUrl(gatewayBaseUrl, '/logout');
      const cookieHeader = `${PLATFORM_SESSION_COOKIE_NAME}=${cookieValue}`;
      await httpRequest(url, http.RequestMethod.POST, '', cookieHeader);
    } catch {
      // best-effort
    }
  }

  /**
   * Change password for the signed-in platform session
   * (Android EmployeeAuthClient.changePassword → /password/change).
   */
  static async changePassword(
    gatewayBaseUrl: string,
    cookieValue: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<PlatformAuthOutcome> {
    try {
      const url = buildPlatformAuthUrl(gatewayBaseUrl, '/password/change');
      const payload = new ChangePasswordBody();
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
      const cookieHeader = PlatformAuthApi.cookieHeader(cookieValue);
      const response = await httpRequest(
        url,
        http.RequestMethod.POST,
        JSON.stringify(payload),
        cookieHeader,
      );
      return successFrom(response.statusCode, response.body, false);
    } catch {
      return fail(-1, 'network', '网络错误或网关不可达');
    }
  }

  static cookieHeader(cookieValue: string): string {
    return `${PLATFORM_SESSION_COOKIE_NAME}=${cookieValue}`;
  }
}
