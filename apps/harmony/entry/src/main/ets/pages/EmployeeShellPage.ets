import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import { resolveBootstrapLoadUrl } from '../employeeshell/EmployeeShellBootstrap';
import {
  EMPLOYEE_SHELL_HANDLER_NAME,
  EmployeeShellHostBridge,
  EmployeeShellIntent,
  embedTargetForIntent,
  parseEmployeeShellBridgeMessage,
} from '../employeeshell/EmployeeShellBridge';
import { PlatformAuthApi } from '../platformauth/PlatformAuthApi';
import { SessionStore } from '../platformauth/SessionStore';

@Component
export struct EmployeeShellPage {
  gatewayBaseUrl: string = '';
  cookieValue: string = '';
  displayName: string = '';
  /** When true, show 关闭 to dismiss overlay (我的→员工工作台). */
  workbenchOverlay: boolean = false;
  onCloseWorkbench: () => void = () => {};
  onSessionExpired: () => void = () => {};
  onLogoutComplete: () => void = () => {};

  private controller: webview.WebviewController = new webview.WebviewController();
  private hostBridge: EmployeeShellHostBridge =
    new EmployeeShellHostBridge((raw: string) => this.handleBridgeMessage(raw));

  @State private loadUrl: string = '';
  @State private bootstrapping: boolean = true;
  @State private showError: boolean = false;
  @State private errorHint: string = '';
  @State private statusHint: string = '';

  aboutToAppear(): void {
    webview.WebviewController.setWebDebuggingAccess(true);
    void this.startBootstrap();
  }

  aboutToDisappear(): void {
    try {
      this.controller.deleteJavaScriptRegister(EMPLOYEE_SHELL_HANDLER_NAME);
    } catch {
      // Controller may not be attached yet.
    }
  }

  private uiContext(): common.UIAbilityContext {
    return getContext(this) as common.UIAbilityContext;
  }

  private handleBridgeMessage(raw: string): void {
    const intent = parseEmployeeShellBridgeMessage(raw);
    if (!intent) {
      return;
    }
    this.dispatchIntent(intent);
  }

  private dispatchIntent(intent: EmployeeShellIntent): void {
    if (intent.type === 'ready') {
      this.statusHint = intent.surface.length > 0 ? `已就绪 · ${intent.surface}` : '已就绪';
      return;
    }

    const target = embedTargetForIntent(intent);
    if (!target) {
      return;
    }

    // Phone shell keeps chat/assistant inside the web embed; bridge intents navigate surfaces.
    let toast = '';
    switch (intent.type) {
      case 'openChat':
        toast = '正在打开协作工作区';
        break;
      case 'openAssistant':
        toast = '正在打开工作区助手';
        break;
      case 'openSpace':
        toast = '正在打开协作空间';
        break;
      case 'openKnowledgeObject':
        toast = '正在打开知识库';
        break;
      case 'openDeviceSettings':
        toast = '正在打开个人设置';
        break;
      default:
        break;
    }
    if (toast.length > 0) {
      try {
        promptAction.showToast({ message: toast, duration: 1500 });
      } catch {
        this.statusHint = toast;
      }
    }
    void this.startBootstrap(target);
  }

  private async startBootstrap(target?: string): Promise<void> {
    this.bootstrapping = true;
    this.showError = false;
    this.errorHint = '';
    const outcome = await resolveBootstrapLoadUrl(
      this.gatewayBaseUrl,
      this.cookieValue,
      target,
    );
    this.bootstrapping = false;
    if (!outcome.ok) {
      this.showError = true;
      this.errorHint = outcome.message.length > 0 ? outcome.message : '引导失败，平台登录可能已过期';
      return;
    }
    this.loadUrl = outcome.url;
  }

  private async logout(): Promise<void> {
    try {
      if (this.cookieValue.length > 0) {
        await PlatformAuthApi.logout(this.gatewayBaseUrl, this.cookieValue);
      }
    } catch {
      // Best-effort logout; still clear local session.
    }
    await SessionStore.clear(this.uiContext());
    this.onLogoutComplete();
  }

  build() {
    Column() {
      Row() {
        Column() {
          Text(this.displayName.length > 0 ? this.displayName : 'OpenBot')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.White)
          if (this.statusHint.length > 0) {
            Text(this.statusHint)
              .fontSize(11)
              .fontColor('#80FFFFFF')
              .margin({ top: 2 })
          } else if (this.workbenchOverlay) {
            Text('员工工作台')
              .fontSize(11)
              .fontColor('#80FFFFFF')
              .margin({ top: 2 })
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        if (this.workbenchOverlay) {
          Button('关闭')
            .type(ButtonType.Normal)
            .fontSize(13)
            .fontColor('#E6FFFFFF')
            .backgroundColor('#22FFFFFF')
            .margin({ right: 8 })
            .onClick(() => {
              this.onCloseWorkbench();
            })
        }

        Button('退出')
          .type(ButtonType.Normal)
          .fontSize(13)
          .fontColor('#E6FFFFFF')
          .backgroundColor('#22FFFFFF')
          .onClick(() => {
            void this.logout();
          })
      }
      .width('100%')
      .height(48)
      .padding({ left: 16, right: 12 })

      if (this.bootstrapping) {
        Column() {
          LoadingProgress().width(40).height(40).color(Color.White)
          Text('正在进入工作区…')
            .fontSize(14)
            .fontColor('#B3FFFFFF')
            .margin({ top: 12 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.showError) {
        Column({ space: 16 }) {
          Text($r('app.string.load_error_title'))
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(Color.White)
          Text(this.errorHint.length > 0 ? this.errorHint : $r('app.string.load_error_hint'))
            .fontSize(14)
            .fontColor('#B3FFFFFF')
            .textAlign(TextAlign.Center)
            .padding({ left: 24, right: 24 })
          Button($r('app.string.action_retry'))
            .type(ButtonType.Capsule)
            .onClick(() => {
              void this.startBootstrap();
            })
          Button('重新登录')
            .type(ButtonType.Capsule)
            .backgroundColor('#33FFFFFF')
            .onClick(() => {
              void this.logout();
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
          .backgroundColor($r('app.color.page_background'))
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
    .backgroundColor($r('app.color.page_background'))
  }
}
