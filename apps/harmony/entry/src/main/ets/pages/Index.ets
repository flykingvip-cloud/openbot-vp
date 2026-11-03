import { common } from '@kit.AbilityKit';
import { PersistedAuthState, SessionStore } from '../platformauth/SessionStore';
import { EmployeeRootTabs } from './EmployeeRootTabs';
import { EmployeeWelcomePage } from './EmployeeWelcomePage';
import { LoginPage } from './LoginPage';
import {
  MOBILE_ACCENT,
  MOBILE_BG_MID,
  MOBILE_TEXT_SECONDARY,
} from '../common/MobileUiTokens';

@Entry
@Component
struct Index {
  @State private authState: PersistedAuthState = new PersistedAuthState();
  @State private ready: boolean = false;
  @State private welcomeSeen: boolean = true;

  aboutToAppear(): void {
    void this.restoreSession();
  }

  private uiContext(): common.UIAbilityContext {
    return getContext(this) as common.UIAbilityContext;
  }

  private async restoreSession(): Promise<void> {
    this.welcomeSeen = await SessionStore.isWelcomeSeen(this.uiContext());
    this.authState = await SessionStore.load(this.uiContext());
    this.ready = true;
  }

  private onLoggedIn(state: PersistedAuthState): void {
    this.authState = state;
  }

  private async onSessionExpired(): Promise<void> {
    const gateway = this.authState.gatewayBaseUrl;
    await SessionStore.clear(this.uiContext());
    this.authState = new PersistedAuthState();
    this.authState.gatewayBaseUrl = gateway;
  }

  private async onLogoutComplete(): Promise<void> {
    const gateway = this.authState.gatewayBaseUrl;
    await SessionStore.clear(this.uiContext());
    this.authState = new PersistedAuthState();
    this.authState.gatewayBaseUrl = gateway;
  }

  private onWelcomeContinue(): void {
    this.welcomeSeen = true;
  }

  build() {
    Column() {
      if (!this.ready) {
        Column() {
          LoadingProgress().width(36).height(36).color(MOBILE_ACCENT)
          Text('加载中…').fontSize(14).fontColor(MOBILE_TEXT_SECONDARY).margin({ top: 12 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor(MOBILE_BG_MID)
      } else if (!this.welcomeSeen) {
        EmployeeWelcomePage({
          onContinue: () => {
            this.onWelcomeContinue();
          },
        })
      } else if (!this.authState.isAuthenticated) {
        LoginPage({
          onLoggedIn: (state: PersistedAuthState) => {
            this.onLoggedIn(state);
          },
        })
      } else {
        EmployeeRootTabs({
          gatewayBaseUrl: this.authState.gatewayBaseUrl,
          cookieValue: this.authState.cookieValue,
          displayName: this.authState.session.displayName,
          email: this.authState.session.email,
          onSessionExpired: () => {
            void this.onSessionExpired();
          },
          onLogoutComplete: () => {
            void this.onLogoutComplete();
          },
        })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MOBILE_BG_MID)
  }
}
