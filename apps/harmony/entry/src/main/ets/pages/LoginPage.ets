import { common } from '@kit.AbilityKit';
import { PlatformAuthApi } from '../platformauth/PlatformAuthApi';
import { PlatformAuthMode, PlatformAuthOutcome } from '../platformauth/PlatformAuthTypes';
import { PersistedAuthState, SessionStore } from '../platformauth/SessionStore';
import { DEFAULT_GATEWAY_BASE_URL } from '../common/OpenBotConfig';

@Component
export struct LoginPage {
  @State mode: PlatformAuthMode = 'login';
  @State email: string = '';
  @State password: string = '';
  @State displayName: string = '';
  @State inviteCode: string = '';
  @State resetCode: string = '';
  @State mfaCode: string = '';
  @State showMfa: boolean = false;
  @State showGatewayField: boolean = false;
  @State gatewayBaseUrl: string = DEFAULT_GATEWAY_BASE_URL;
  @State busy: boolean = false;
  @State errorMessage: string = '';
  @State noticeMessage: string = '';
  onLoggedIn: (state: PersistedAuthState) => void = (_state: PersistedAuthState) => {};

  aboutToAppear(): void {
    void this.loadSavedGateway();
  }

  private uiContext(): common.UIAbilityContext {
    return getContext(this) as common.UIAbilityContext;
  }

  private async loadSavedGateway(): Promise<void> {
    const saved = await SessionStore.load(this.uiContext());
    if (saved.gatewayBaseUrl.trim().length > 0) {
      this.gatewayBaseUrl = saved.gatewayBaseUrl;
    }
  }

  private subtitle(): string {
    switch (this.mode) {
      case 'register':
        return '使用邀请码加入企业工作区。';
      case 'forgot':
        return '输入邮箱，获取密码重置验证码。';
      case 'reset':
        return '输入验证码与新密码完成重置。';
      default:
        return '登录工作区，继续你的协作。';
    }
  }

  private primaryTitle(): string {
    if (this.busy) {
      return '请稍候…';
    }
    switch (this.mode) {
      case 'register':
        return '加入工作区';
      case 'forgot':
        return '发送重置码';
      case 'reset':
        return '更新密码';
      default:
        return this.showMfa ? '验证并登录' : '登录';
    }
  }

  private switchMode(next: PlatformAuthMode): void {
    this.mode = next;
    this.errorMessage = '';
    this.noticeMessage = '';
    this.showMfa = false;
    this.mfaCode = '';
  }

  private async persistAndEnter(
    gateway: string,
    cookieValue: string,
    email: string,
    displayName: string,
    userId: string,
  ): Promise<void> {
    const state = new PersistedAuthState();
    state.gatewayBaseUrl = gateway;
    state.cookieValue = cookieValue;
    state.session.email = email;
    state.session.displayName = displayName;
    state.session.userId = userId;
    await SessionStore.save(this.uiContext(), state);
    this.password = '';
    this.mfaCode = '';
    this.onLoggedIn(state);
  }

  private async submit(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.errorMessage = '';
    this.noticeMessage = '';
    const email = this.email.trim();
    const gateway = this.gatewayBaseUrl.trim() || DEFAULT_GATEWAY_BASE_URL;
    if (email.length === 0) {
      this.errorMessage = '请输入邮箱';
      return;
    }

    this.busy = true;
    let outcome: PlatformAuthOutcome = new PlatformAuthOutcome();

    if (this.mode === 'login') {
      if (this.password.length === 0) {
        this.errorMessage = '请输入密码';
        this.busy = false;
        return;
      }
      outcome = await PlatformAuthApi.login(
        gateway,
        email,
        this.password,
        this.showMfa ? this.mfaCode : undefined,
      );
    } else if (this.mode === 'register') {
      if (this.password.length === 0 || this.inviteCode.trim().length === 0) {
        this.errorMessage = '请填写密码与邀请码';
        this.busy = false;
        return;
      }
      outcome = await PlatformAuthApi.register(
        gateway,
        email,
        this.password,
        this.displayName,
        this.inviteCode,
      );
    } else if (this.mode === 'forgot') {
      outcome = await PlatformAuthApi.forgotPassword(gateway, email);
      if (outcome.ok) {
        const notice = outcome.result.pendingResetCode.length > 0
          ? `已生成重置码（开发环境）：${outcome.result.pendingResetCode}`
          : '重置邮件已发送，请查收验证码后完成重置。';
        this.mode = 'reset';
        this.errorMessage = '';
        this.showMfa = false;
        this.mfaCode = '';
        this.noticeMessage = notice;
        this.busy = false;
        return;
      }
    } else if (this.mode === 'reset') {
      if (this.password.length === 0 || this.resetCode.trim().length === 0) {
        this.errorMessage = '请填写新密码与验证码';
        this.busy = false;
        return;
      }
      outcome = await PlatformAuthApi.resetPassword(
        gateway,
        email,
        this.password,
        this.resetCode,
      );
    }

    if (!outcome.ok) {
      this.errorMessage = outcome.message.length > 0 ? outcome.message : '请求失败';
      if (this.mode === 'login' && outcome.requiresMfa) {
        this.showMfa = true;
        if (outcome.code === 'PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST') {
          this.noticeMessage = '请先完成两步验证绑定，再输入验证器中的动态码。';
        } else if (outcome.code === 'PLATFORM_AUTH_MFA_REQUIRED') {
          this.noticeMessage = '请输入验证器中的动态码。';
        }
      }
      this.busy = false;
      return;
    }

    await this.persistAndEnter(
      gateway,
      outcome.result.cookieValue,
      outcome.result.session.email || email,
      outcome.result.session.displayName || this.displayName || email,
      outcome.result.session.userId || email,
    );
    this.busy = false;
  }

  @Builder
  modeTabs() {
    if (this.mode === 'login' || this.mode === 'register') {
      Row() {
        Button('登录')
          .type(ButtonType.Capsule)
          .fontSize(13)
          .backgroundColor(this.mode === 'login' ? '#FF3B82F6' : '#22FFFFFF')
          .fontColor(Color.White)
          .layoutWeight(1)
          .enabled(!this.busy)
          .onClick(() => this.switchMode('login'))
        Button('注册')
          .type(ButtonType.Capsule)
          .fontSize(13)
          .backgroundColor(this.mode === 'register' ? '#FF3B82F6' : '#22FFFFFF')
          .fontColor(Color.White)
          .layoutWeight(1)
          .margin({ left: 10 })
          .enabled(!this.busy)
          .onClick(() => this.switchMode('register'))
      }
      .width('100%')
    } else {
      Button('← 返回登录')
        .type(ButtonType.Normal)
        .fontSize(13)
        .fontColor(Color.White)
        .backgroundColor(Color.Transparent)
        .enabled(!this.busy)
        .onClick(() => this.switchMode('login'))
    }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('OpenBot')
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor(Color.White)
        Text(this.subtitle())
          .fontSize(14)
          .fontColor('#B3FFFFFF')
          .textAlign(TextAlign.Center)

        this.modeTabs()

        if (this.mode === 'register') {
          TextInput({ placeholder: '显示名称' })
            .height(48)
            .backgroundColor('#1AFFFFFF')
            .fontColor(Color.White)
            .placeholderColor('#80FFFFFF')
            .onChange((value: string) => {
              this.displayName = value;
            })
        }

        TextInput({ placeholder: '邮箱' })
          .type(InputType.Email)
          .height(48)
          .backgroundColor('#1AFFFFFF')
          .fontColor(Color.White)
          .placeholderColor('#80FFFFFF')
          .onChange((value: string) => {
            this.email = value;
          })

        if (this.mode === 'login' || this.mode === 'register' || this.mode === 'reset') {
          TextInput({ placeholder: this.mode === 'reset' ? '新密码' : '密码' })
            .type(InputType.Password)
            .height(48)
            .backgroundColor('#1AFFFFFF')
            .fontColor(Color.White)
            .placeholderColor('#80FFFFFF')
            .onChange((value: string) => {
              this.password = value;
            })
        }

        if (this.mode === 'register') {
          TextInput({ placeholder: '企业邀请码' })
            .height(48)
            .backgroundColor('#1AFFFFFF')
            .fontColor(Color.White)
            .placeholderColor('#80FFFFFF')
            .onChange((value: string) => {
              this.inviteCode = value;
            })
        }

        if (this.mode === 'reset') {
          TextInput({ placeholder: '邮件中的重置码' })
            .height(48)
            .backgroundColor('#1AFFFFFF')
            .fontColor(Color.White)
            .placeholderColor('#80FFFFFF')
            .onChange((value: string) => {
              this.resetCode = value;
            })
        }

        if (this.mode === 'login' && this.showMfa) {
          TextInput({ placeholder: '两步验证码 / MFA' })
            .height(48)
            .backgroundColor('#1AFFFFFF')
            .fontColor(Color.White)
            .placeholderColor('#80FFFFFF')
            .onChange((value: string) => {
              this.mfaCode = value;
            })
        }

        if (this.showGatewayField) {
          TextInput({ placeholder: 'Gateway 地址', text: this.gatewayBaseUrl })
            .height(44)
            .backgroundColor('#12FFFFFF')
            .fontColor('#E6FFFFFF')
            .placeholderColor('#66FFFFFF')
            .onChange((value: string) => {
              this.gatewayBaseUrl = value;
            })
        }

        if (this.errorMessage.length > 0) {
          Text(this.errorMessage)
            .fontSize(13)
            .fontColor('#FF8A80')
            .width('100%')
        } else if (this.noticeMessage.length > 0) {
          Text(this.noticeMessage)
            .fontSize(13)
            .fontColor('#A5D6A7')
            .width('100%')
        }

        Button(this.primaryTitle())
          .type(ButtonType.Capsule)
          .width('100%')
          .height(48)
          .enabled(!this.busy)
          .onClick(() => {
            void this.submit();
          })

        Row() {
          if (this.mode === 'login') {
            Button('忘记密码？')
              .type(ButtonType.Normal)
              .fontSize(12)
              .fontColor('#93C5FD')
              .backgroundColor(Color.Transparent)
              .enabled(!this.busy)
              .onClick(() => this.switchMode('forgot'))
          }
          if (this.mode === 'forgot') {
            Button('我有验证码')
              .type(ButtonType.Normal)
              .fontSize(12)
              .fontColor('#93C5FD')
              .backgroundColor(Color.Transparent)
              .enabled(!this.busy)
              .onClick(() => this.switchMode('reset'))
          }
          Blank()
          Button(this.showGatewayField ? '收起网关' : '高级')
            .type(ButtonType.Normal)
            .fontSize(12)
            .fontColor('#80FFFFFF')
            .backgroundColor(Color.Transparent)
            .enabled(!this.busy)
            .onClick(() => {
              this.showGatewayField = !this.showGatewayField;
            })
        }
        .width('100%')
      }
      .padding({ left: 28, right: 28, top: 48, bottom: 32 })
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.page_background'))
  }
}
