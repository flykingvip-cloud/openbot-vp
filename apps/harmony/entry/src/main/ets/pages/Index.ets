import { common } from '@kit.AbilityKit';
import { PersistedAuthState, SessionStore } from '../platformauth/SessionStore';
import { EmployeeShellPage } from './EmployeeShellPage';
import { EmployeeWelcomePage } from './EmployeeWelcomePage';
import { LoginPage } from './LoginPage';

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
          LoadingProgress().width(36).height(36).color('#8C6629')
          Text('加载中…').fontSize(14).fontColor('#78716C').margin({ top: 12 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#F6F5F2')
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
        EmployeeShellPage({
          gatewayBaseUrl: this.authState.gatewayBaseUrl,
          cookieValue: this.authState.cookieValue,
          displayName: this.authState.session.displayName,
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
    .backgroundColor($r('app.color.page_background'))
  }
}
