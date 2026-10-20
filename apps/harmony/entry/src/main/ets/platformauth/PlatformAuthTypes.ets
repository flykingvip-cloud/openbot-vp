export const PLATFORM_SESSION_COOKIE_NAME: string = 'openbot_platform_session';

export type PlatformAuthMode = 'login' | 'register' | 'forgot' | 'reset';

export class PlatformAuthSession {
  userId: string = '';
  email: string = '';
  displayName: string = '';
}

export class PlatformAuthLoginResult {
  session: PlatformAuthSession = new PlatformAuthSession();
  cookieValue: string = '';
  pendingResetCode: string = '';
}

/** Non-throwing API outcome for ArkTS catch restrictions. */
export class PlatformAuthOutcome {
  ok: boolean = false;
  result: PlatformAuthLoginResult = new PlatformAuthLoginResult();
  statusCode: number = 0;
  code: string = '';
  message: string = '';

  get requiresMfa(): boolean {
    return this.code === 'PLATFORM_AUTH_MFA_REQUIRED' ||
      this.code === 'PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST' ||
      this.code === 'PLATFORM_AUTH_MFA_INVALID';
  }
}
