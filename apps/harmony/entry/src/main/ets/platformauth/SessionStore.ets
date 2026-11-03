import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { DEFAULT_GATEWAY_BASE_URL } from '../common/OpenBotConfig';
import { PlatformAuthSession } from './PlatformAuthTypes';

const PREF_NAME: string = 'openbot_platform_auth';
const KEY_GATEWAY: string = 'gateway_base_url';
const KEY_COOKIE: string = 'platform_session_cookie';
const KEY_EMAIL: string = 'session_email';
const KEY_DISPLAY: string = 'session_display_name';
const KEY_USER_ID: string = 'session_user_id';
const KEY_WELCOME_SEEN: string = 'employee.welcome.seen';

export class PersistedAuthState {
  gatewayBaseUrl: string = DEFAULT_GATEWAY_BASE_URL;
  cookieValue: string = '';
  session: PlatformAuthSession = new PlatformAuthSession();

  get isAuthenticated(): boolean {
    return this.cookieValue.trim().length > 0;
  }
}

export class SessionStore {
  private static async prefs(context: common.UIAbilityContext): Promise<preferences.Preferences> {
    return preferences.getPreferences(context, PREF_NAME);
  }

  static async load(context: common.UIAbilityContext): Promise<PersistedAuthState> {
    const state = new PersistedAuthState();
    const pref = await SessionStore.prefs(context);
    state.gatewayBaseUrl =
      (await pref.get(KEY_GATEWAY, DEFAULT_GATEWAY_BASE_URL)) as string;
    state.cookieValue = (await pref.get(KEY_COOKIE, '')) as string;
    state.session.email = (await pref.get(KEY_EMAIL, '')) as string;
    state.session.displayName = (await pref.get(KEY_DISPLAY, '')) as string;
    state.session.userId = (await pref.get(KEY_USER_ID, '')) as string;
    return state;
  }

  static async save(context: common.UIAbilityContext, state: PersistedAuthState): Promise<void> {
    const pref = await SessionStore.prefs(context);
    await pref.put(KEY_GATEWAY, state.gatewayBaseUrl.trim());
    await pref.put(KEY_COOKIE, state.cookieValue.trim());
    await pref.put(KEY_EMAIL, state.session.email);
    await pref.put(KEY_DISPLAY, state.session.displayName);
    await pref.put(KEY_USER_ID, state.session.userId);
    await pref.flush();
  }

  static async clear(context: common.UIAbilityContext): Promise<void> {
    const pref = await SessionStore.prefs(context);
    await pref.delete(KEY_COOKIE);
    await pref.delete(KEY_EMAIL);
    await pref.delete(KEY_DISPLAY);
    await pref.delete(KEY_USER_ID);
    await pref.flush();
  }

  /** First-install welcome flag. Missing key → false (show once). */
  static async isWelcomeSeen(context: common.UIAbilityContext): Promise<boolean> {
    const pref = await SessionStore.prefs(context);
    const has = await pref.has(KEY_WELCOME_SEEN);
    if (!has) {
      // Upgrade users with an existing session skip the first-run card.
      const cookie = ((await pref.get(KEY_COOKIE, '')) as string).trim();
      if (cookie.length > 0) {
        await pref.put(KEY_WELCOME_SEEN, true);
        await pref.flush();
        return true;
      }
      return false;
    }
    return (await pref.get(KEY_WELCOME_SEEN, false)) as boolean;
  }

  static async setWelcomeSeen(context: common.UIAbilityContext, value: boolean): Promise<void> {
    const pref = await SessionStore.prefs(context);
    await pref.put(KEY_WELCOME_SEEN, value);
    await pref.flush();
  }
}
