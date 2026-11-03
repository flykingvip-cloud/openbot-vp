import { webview } from '@kit.ArkWeb';
import { resolveBootstrapLoadUrl } from '../employeeshell/EmployeeShellBootstrap';
import {
  EMPLOYEE_SHELL_HANDLER_NAME,
  EmployeeShellHostBridge,
  embedTargetForIntent,
  parseEmployeeShellBridgeMessage,
} from '../employeeshell/EmployeeShellBridge';
import {
  MOBILE_ACCENT,
  MOBILE_TEXT,
  MOBILE_TEXT_SECONDARY,
} from '../common/MobileUiTokens';

/**
 * Bootstrap + WebView embed for Chat / Tasks / Knowledge tabs.
 * Native four-tab chrome owns Me; these surfaces stay on employee embed until
 * ArkTS can host full Gateway chat/tasks/knowledge (Android uses native there).
 */
@Component
export struct EmployeeWebEmbed {
  @Prop gatewayBaseUrl: string = '';
  @Prop cookieValue: string = '';
  @Prop targetPath: string = '';
  @Prop title: string = '';
  onSessionExpired: () => void = () => {};
  onNavigateTarget: (target: string) => void = (_t: string) => {};

  private controller: webview.WebviewController = new webview.WebviewController();
  private hostBridge: EmployeeShellHostBridge =
    new EmployeeShellHostBridge((raw: string) => this.handleBridgeMessage(raw));

  @State private loadUrl: string = '';
  @State private bootstrapping: boolean = true;
  @State private showError: boolean = false;
  @State private errorHint: string = '';
  private lastBootstrappedTarget: string = '';

  aboutToAppear(): void {
    webview.WebviewController.setWebDebuggingAccess(true);
    void this.startBootstrap(this.targetPath);
  }

  aboutToDisappear(): void {
    try {
      this.controller.deleteJavaScriptRegister(EMPLOYEE_SHELL_HANDLER_NAME);
    } catch {
      // Controller may not be attached yet.
    }
  }

  /** Parent can call via @Watch-equivalent by remounting / keying targetPath. */
  onTargetChanged(): void {
    if (this.targetPath !== this.lastBootstrappedTarget) {
      void this.startBootstrap(this.targetPath);
    }
  }

  private handleBridgeMessage(raw: string): void {
    const intent = parseEmployeeShellBridgeMessage(raw);
    if (!intent) {
      return;
    }
    if (intent.type === 'ready') {
      return;
    }
    const target = embedTargetForIntent(intent);
    if (target) {
      this.onNavigateTarget(target);
      void this.startBootstrap(target);
    }
  }

  private async startBootstrap(target: string): Promise<void> {
    const marked = target.length > 0 ? target : this.targetPath;
    this.lastBootstrappedTarget = marked;
    this.bootstrapping = true;
    this.showError = false;
    this.errorHint = '';
    const outcome = await resolveBootstrapLoadUrl(
      this.gatewayBaseUrl,
      this.cookieValue,
      marked,
    );
    this.bootstrapping = false;
    if (!outcome.ok) {
      this.showError = true;
      this.errorHint = outcome.message.length > 0 ? outcome.message : '引导失败，平台登录可能已过期';
      return;
    }
    this.loadUrl = outcome.url;
  }

  build() {
    Column() {
      if (this.title.length > 0) {
        Text(this.title)
          .fontSize(24)
          .fontWeight(FontWeight.Medium)
          .fontColor(MOBILE_TEXT)
          .width('100%')
          .padding({ left: 20, right: 20, top: 16, bottom: 8 })
      }

      if (this.bootstrapping) {
        Column() {
          LoadingProgress().width(36).height(36).color(MOBILE_ACCENT)
          Text('正在加载…')
            .fontSize(14)
            .fontColor(MOBILE_TEXT_SECONDARY)
            .margin({ top: 12 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.showError) {
        Column({ space: 12 }) {
          Text('无法加载')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(MOBILE_TEXT)
          Text(this.errorHint)
            .fontSize(14)
            .fontColor(MOBILE_TEXT_SECONDARY)
            .textAlign(TextAlign.Center)
            .padding({ left: 24, right: 24 })
          Button('重试')
            .type(ButtonType.Capsule)
            .backgroundColor(MOBILE_ACCENT)
            .fontColor(Color.White)
            .onClick(() => {
              void this.startBootstrap(this.targetPath);
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.loadUrl.length > 0) {
        Web({ src: this.loadUrl, controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .databaseAccess(true)
          .fileAccess(true)
          .imageAccess(true)
          .onlineImageAccess(true)
          .mixedMode(MixedMode.All)
          .cacheMode(CacheMode.Default)
          .javaScriptProxy({
            object: this.hostBridge,
            name: EMPLOYEE_SHELL_HANDLER_NAME,
            methodList: ['postMessage'],
            controller: this.controller,
          })
          .width('100%')
          .layoutWeight(1)
          .backgroundColor(Color.Transparent)
          .onHttpErrorReceive((event) => {
            if (!event || !event.response || !event.request) {
              return;
            }
            const code = event.response.getResponseCode();
            const mainFrame = event.request.isMainFrame();
            if (mainFrame && code === 401) {
              this.onSessionExpired();
            }
          })
          .onErrorReceive(() => {
            this.showError = true;
            this.errorHint = '页面加载失败';
          })
      }
    }
    .width('100%')
    .height('100%')
  }
}
