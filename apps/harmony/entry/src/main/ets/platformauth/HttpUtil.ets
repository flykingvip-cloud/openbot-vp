import { http } from '@kit.NetworkKit';
import { PLATFORM_SESSION_COOKIE_NAME } from './PlatformAuthTypes';

export class HttpResponse {
  statusCode: number = -1;
  body: string = '';
  setCookie: string = '';
  location: string = '';
}

class HttpRequestConfig {
  method: http.RequestMethod = http.RequestMethod.GET;
  header: Record<string, string> = {} as Record<string, string>;
  extraData: string = '';
  expectDataType: http.HttpDataType = http.HttpDataType.STRING;
  readTimeout: number = 30000;
  connectTimeout: number = 30000;
}

function readHeaderField(headers: Record<string, string>, key: string): string {
  const lower = key.toLowerCase();
  const upper = key.toUpperCase();
  if (headers[key] !== undefined && headers[key].length > 0) {
    return headers[key];
  }
  if (headers[lower] !== undefined && headers[lower].length > 0) {
    return headers[lower];
  }
  if (headers[upper] !== undefined && headers[upper].length > 0) {
    return headers[upper];
  }
  return '';
}

/** Parse `openbot_platform_session` from Set-Cookie (login / register response). */
export function extractPlatformSessionCookie(setCookie: string): string {
  if (setCookie.length === 0) {
    return '';
  }
  const lines = setCookie.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const name = first.substring(0, eq).trim();
    if (name === PLATFORM_SESSION_COOKIE_NAME) {
      return first.substring(eq + 1).trim();
    }
  }
  // Single Set-Cookie without newlines
  const firstOnly = setCookie.split(';')[0].trim();
  const eq = firstOnly.indexOf('=');
  if (eq > 0 && firstOnly.substring(0, eq).trim() === PLATFORM_SESSION_COOKIE_NAME) {
    return firstOnly.substring(eq + 1).trim();
  }
  return '';
}

function buildHeader(withJsonBody: boolean, cookieHeader?: string): Record<string, string> {
  const header = {} as Record<string, string>;
  header['Accept'] = 'application/json';
  if (withJsonBody) {
    header['Content-Type'] = 'application/json';
  }
  if (cookieHeader !== undefined && cookieHeader.length > 0) {
    header['Cookie'] = cookieHeader;
  }
  return header;
}

export async function httpRequest(
  url: string,
  method: http.RequestMethod,
  extraData?: string,
  cookieHeader?: string,
): Promise<HttpResponse> {
  const client = http.createHttp();
  const response = new HttpResponse();
  try {
    const withJsonBody = extraData !== undefined && method !== http.RequestMethod.GET;
    const config = new HttpRequestConfig();
    config.method = method;
    config.header = buildHeader(withJsonBody, cookieHeader);
    config.extraData = extraData ?? '';
    config.expectDataType = http.HttpDataType.STRING;
    config.readTimeout = 30000;
    config.connectTimeout = 30000;

    const result = await client.request(url, config);
    response.statusCode = result.responseCode;
    if (typeof result.result === 'string') {
      response.body = result.result;
    } else if (result.result !== undefined && result.result !== null) {
      response.body = JSON.stringify(result.result);
    } else {
      response.body = '';
    }

    const rawHeader = result.header as Record<string, string>;
    if (rawHeader) {
      response.setCookie = readHeaderField(rawHeader, 'set-cookie');
      response.location = readHeaderField(rawHeader, 'location');
    }
    return response;
  } finally {
    client.destroy();
  }
}
