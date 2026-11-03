import { PlatformAuthApi } from '../platformauth/PlatformAuthApi';
import {
  MOBILE_ACCENT,
  MOBILE_ACCENT_SOFT,
  MOBILE_BORDER,
  MOBILE_PAGE_GUTTER,
  MOBILE_PAGE_VERTICAL,
  MOBILE_SURFACE,
  MOBILE_TEXT,
  MOBILE_TEXT_SECONDARY,
  MOBILE_TEXT_TERTIARY,
  MOBILE_WARNING_SOFT,
} from '../common/MobileUiTokens';

/** Me hub routes — mirror Android MeSheet. */
class MeRoute {
  static readonly HUB: string = 'hub';
  static readonly ACCOUNT_INFO: string = 'accountInfo';
  static readonly SECURITY: string = 'security';
  static readonly PREFS: string = 'prefs';
  static readonly AUTH: string = 'auth';
  static readonly PERMS: string = 'perms';
  static readonly ROBOTS: string = 'robots';
  static readonly GROUPS: string = 'groups';
}

/**
 * Native 「我的」: 个人设置｜设备｜更多 — Android MeTabScreen IA.
 * No connection-status primary entry; no logout in Account (logout on 员工工作台).
 */
@Component
export struct MeTabPage {
  @Prop displayName: string = '';
  @Prop email: string = '';
  @Prop gatewayBaseUrl: string = '';
  @Prop cookieValue: string = '';
  onOpenEmployeeWorkbench: () => void = () => {};

  @State private segmentIndex: number = 0;
  @State private route: string = MeRoute.HUB;
  @State private notice: string = '';
  @State private currentPassword: string = '';
  @State private newPassword: string = '';
  @State private confirmPassword: string = '';
  @State private securityBusy: boolean = false;

  private avatarGlyph(): string {
    const src = this.displayName.length > 0 ? this.displayName : this.email;
    if (src.length === 0) {
      return '?';
    }
    return src.substring(0, 1).toUpperCase();
  }

  private shownName(): string {
    if (this.displayName.length > 0) {
      return this.displayName;
    }
    if (this.email.length > 0) {
      return this.email;
    }
    return '员工';
  }

  private orgLine(): string {
    return '组织未同步';
  }

  private routeTitle(): string {
    switch (this.route) {
      case MeRoute.ACCOUNT_INFO:
        return '账号信息';
      case MeRoute.SECURITY:
        return '账号安全';
      case MeRoute.PREFS:
        return '偏好';
      case MeRoute.AUTH:
        return '授权';
      case MeRoute.PERMS:
        return '设备与权限';
      case MeRoute.ROBOTS:
        return '我的机器人';
      case MeRoute.GROUPS:
        return '我的协作小组';
      default:
        return '我的';
    }
  }

  private goHub(): void {
    this.route = MeRoute.HUB;
  }

  private openRoute(next: string): void {
    this.notice = '';
    this.route = next;
  }

  private async submitChangePassword(): Promise<void> {
    if (this.currentPassword.trim().length === 0) {
      this.notice = '请输入当前密码';
      this.route = MeRoute.HUB;
      this.segmentIndex = 0;
      return;
    }
    if (this.newPassword.length < 8) {
      this.notice = '新密码至少 8 位';
      this.route = MeRoute.HUB;
      this.segmentIndex = 0;
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.notice = '两次输入的新密码不一致';
      this.route = MeRoute.HUB;
      this.segmentIndex = 0;
      return;
    }
    if (this.newPassword === this.currentPassword) {
      this.notice = '新密码不能与当前密码相同';
      this.route = MeRoute.HUB;
      this.segmentIndex = 0;
      return;
    }
    this.securityBusy = true;
    const outcome = await PlatformAuthApi.changePassword(
      this.gatewayBaseUrl,
      this.cookieValue,
      this.currentPassword,
      this.newPassword,
    );
    this.securityBusy = false;
    if (outcome.ok) {
      this.notice = outcome.message.length > 0 ? outcome.message : '密码已更新';
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
    } else {
      this.notice = `改密失败：${outcome.message.length > 0 ? outcome.message : '未知错误'}`;
    }
    this.route = MeRoute.HUB;
    this.segmentIndex = 0;
  }

  @Builder
  softBanner(text: string) {
    Text(text)
      .fontSize(13)
      .fontColor(MOBILE_TEXT_SECONDARY)
      .width('100%')
      .padding(12)
      .backgroundColor(MOBILE_WARNING_SOFT)
      .borderRadius(12)
  }

  @Builder
  sectionLabel(text: string) {
    Text(text)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor(MOBILE_TEXT_TERTIARY)
      .margin({ top: 4, bottom: 2 })
  }

  @Builder
  navRow(title: string, subtitle: string, action: () => void) {
    Row() {
      Column() {
        Text(title)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(MOBILE_TEXT)
        Text(subtitle)
          .fontSize(12)
          .fontColor(MOBILE_TEXT_SECONDARY)
          .margin({ top: 2 })
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Text('›')
        .fontSize(20)
        .fontColor(MOBILE_TEXT_TERTIARY)
    }
    .width('100%')
    .padding(14)
    .backgroundColor(Color.White)
    .borderRadius(14)
    .border({ width: 1, color: MOBILE_BORDER })
    .onClick(() => action())
  }

  @Builder
  identityCard() {
    Row({ space: 12 }) {
      Column() {
        Text(this.avatarGlyph())
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(MOBILE_ACCENT)
      }
      .width(44)
      .height(44)
      .borderRadius(22)
      .backgroundColor(MOBILE_ACCENT_SOFT)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)

      Column({ space: 3 }) {
        Text(this.shownName())
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(MOBILE_TEXT)
        Text(this.email.length > 0 ? this.email : '未绑定邮箱')
          .fontSize(14)
          .fontColor(MOBILE_TEXT_SECONDARY)
        Text(this.orgLine())
          .fontSize(12)
          .fontColor(MOBILE_TEXT_TERTIARY)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding(14)
    .backgroundColor(Color.White)
    .borderRadius(14)
    .border({ width: 1, color: MOBILE_BORDER })
  }

  private segmentLabelIndex(label: string): number {
    if (label === '设备') {
      return 1;
    }
    if (label === '更多') {
      return 2;
    }
    return 0;
  }

  @Builder
  segmentBar() {
    Row({ space: 6 }) {
      ForEach(['个人设置', '设备', '更多'], (label: string) => {
        Text(label)
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.segmentIndex === this.segmentLabelIndex(label) ? MOBILE_ACCENT : MOBILE_TEXT_SECONDARY)
          .padding({ left: 12, right: 12, top: 8, bottom: 8 })
          .backgroundColor(this.segmentIndex === this.segmentLabelIndex(label) ? MOBILE_ACCENT_SOFT : Color.Transparent)
          .borderRadius(10)
          .onClick(() => {
            this.segmentIndex = this.segmentLabelIndex(label);
            this.notice = '';
          })
      }, (label: string) => label)
    }
    .width('100%')
    .padding(4)
    .backgroundColor(MOBILE_SURFACE)
    .borderRadius(12)
  }

  @Builder
  personalSegment() {
    Column({ space: 10 }) {
      this.identityCard()
      this.sectionLabel('账号与安全')
      this.navRow('账号信息', '个人资料 · 企业与岗位', () => this.openRoute(MeRoute.ACCOUNT_INFO))
      this.navRow('安全', '登录密码', () => this.openRoute(MeRoute.SECURITY))
      this.navRow('偏好', '语言 · 主题', () => this.openRoute(MeRoute.PREFS))
      this.navRow('授权', '工作身份', () => this.openRoute(MeRoute.AUTH))
    }
    .width('100%')
  }

  @Builder
  deviceSegment() {
    Column({ space: 10 }) {
      this.sectionLabel('系统权限')
      this.navRow('设备与权限', '麦克风、相机、通知、定位', () => this.openRoute(MeRoute.PERMS))
    }
    .width('100%')
  }

  @Builder
  moreSegment() {
    Column({ space: 10 }) {
      this.navRow('我的机器人', '身份、能力与协作', () => this.openRoute(MeRoute.ROBOTS))
      this.navRow('我的协作小组', '成员与协作', () => this.openRoute(MeRoute.GROUPS))
      this.navRow('员工工作台', '打开完整工作台', () => this.onOpenEmployeeWorkbench())
    }
    .width('100%')
  }

  @Builder
  hubBody() {
    Scroll() {
      Column({ space: 16 }) {
        Text('我的')
          .fontSize(24)
          .fontWeight(FontWeight.Medium)
          .fontColor(MOBILE_TEXT)
          .width('100%')

        this.segmentBar()

        if (this.notice.length > 0) {
          this.softBanner(this.notice)
        }

        if (this.segmentIndex === 0) {
          this.personalSegment()
        } else if (this.segmentIndex === 1) {
          this.deviceSegment()
        } else {
          this.moreSegment()
        }
      }
      .padding({
        left: MOBILE_PAGE_GUTTER,
        right: MOBILE_PAGE_GUTTER,
        top: MOBILE_PAGE_VERTICAL,
        bottom: MOBILE_PAGE_VERTICAL,
      })
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
  }

  @Builder
  infoLine(label: string, value: string) {
    Column({ space: 4 }) {
      Text(label)
        .fontSize(12)
        .fontColor(MOBILE_TEXT_TERTIARY)
      Text(value)
        .fontSize(15)
        .fontColor(MOBILE_TEXT)
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  @Builder
  accountInfoBody() {
    Column({ space: 12 }) {
      this.softBanner('账号资料当前为只读，完整编辑请到员工工作台。')
      this.sectionLabel('个人资料')
      Column({ space: 10 }) {
        this.infoLine('显示名称', this.shownName())
        this.infoLine('邮箱', this.email.length > 0 ? this.email : '—')
      }
      .width('100%')
      .padding(14)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: MOBILE_BORDER })

      this.sectionLabel('企业与岗位')
      Column({ space: 10 }) {
        this.infoLine('组织', this.orgLine())
      }
      .width('100%')
      .padding(14)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: MOBILE_BORDER })
    }
    .width('100%')
  }

  @Builder
  securityBody() {
    Column({ space: 12 }) {
      this.softBanner('用于修改登录密码。')
      this.sectionLabel('修改密码')
      TextInput({ placeholder: '当前密码', text: this.currentPassword })
        .type(InputType.Password)
        .height(48)
        .backgroundColor(Color.White)
        .fontColor(MOBILE_TEXT)
        .border({ width: 1, color: MOBILE_BORDER })
        .borderRadius(12)
        .onChange((v: string) => {
          this.currentPassword = v;
        })
      TextInput({ placeholder: '新密码', text: this.newPassword })
        .type(InputType.Password)
        .height(48)
        .backgroundColor(Color.White)
        .fontColor(MOBILE_TEXT)
        .border({ width: 1, color: MOBILE_BORDER })
        .borderRadius(12)
        .onChange((v: string) => {
          this.newPassword = v;
        })
      TextInput({ placeholder: '确认新密码', text: this.confirmPassword })
        .type(InputType.Password)
        .height(48)
        .backgroundColor(Color.White)
        .fontColor(MOBILE_TEXT)
        .border({ width: 1, color: MOBILE_BORDER })
        .borderRadius(12)
        .onChange((v: string) => {
          this.confirmPassword = v;
        })
      Button(this.securityBusy ? '保存中…' : '保存')
        .type(ButtonType.Capsule)
        .width('100%')
        .height(44)
        .backgroundColor(MOBILE_ACCENT)
        .fontColor(Color.White)
        .enabled(!this.securityBusy)
        .onClick(() => {
          void this.submitChangePassword();
        })
    }
    .width('100%')
  }

  @Builder
  prefsBody() {
    Column({ space: 12 }) {
      this.softBanner('语言与主题跟随系统；完整偏好可在员工工作台调整。')
      this.sectionLabel('界面与语言')
      Column({ space: 10 }) {
        this.infoLine('语言', '跟随系统')
        this.infoLine('主题', '跟随系统')
      }
      .width('100%')
      .padding(14)
      .backgroundColor(Color.White)
      .borderRadius(14)
      .border({ width: 1, color: MOBILE_BORDER })
    }
    .width('100%')
  }

  @Builder
  authBody() {
    Column({ space: 12 }) {
      this.softBanner('查看工作身份与可用模型；完整授权可在员工工作台完成。')
      this.sectionLabel('个人自有身份')
      this.softBanner('暂无个人身份。可到员工工作台绑定。')
      Button('打开员工工作台')
        .type(ButtonType.Capsule)
        .width('100%')
        .height(44)
        .backgroundColor(MOBILE_ACCENT)
        .fontColor(Color.White)
        .onClick(() => {
          this.onOpenEmployeeWorkbench();
        })
    }
    .width('100%')
  }

  @Builder
  permsBody() {
    Column({ space: 12 }) {
      this.softBanner('权限由系统管理；可在系统设置中调整麦克风、相机、通知与定位。')
      ForEach(
        ['麦克风', '相机', '通知', '定位'],
        (name: string) => {
          Row() {
            Text(name)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(MOBILE_TEXT)
              .layoutWeight(1)
            Text('系统设置')
              .fontSize(12)
              .fontColor(MOBILE_TEXT_SECONDARY)
          }
          .width('100%')
          .padding(14)
          .backgroundColor(Color.White)
          .borderRadius(12)
          .border({ width: 1, color: MOBILE_BORDER })
        },
        (name: string) => name,
      )
    }
    .width('100%')
  }

  @Builder
  emptyListBody(emptyText: string) {
    Column({ space: 12 }) {
      this.softBanner(emptyText)
      this.softBanner('完整管理请到员工工作台。')
      Button('打开员工工作台')
        .type(ButtonType.Capsule)
        .width('100%')
        .height(44)
        .backgroundColor(MOBILE_ACCENT)
        .fontColor(Color.White)
        .onClick(() => {
          this.onOpenEmployeeWorkbench();
        })
    }
    .width('100%')
  }

  @Builder
  secondaryBody() {
    Column() {
      Row() {
        Text('‹ 我的')
          .fontSize(15)
          .fontColor(MOBILE_ACCENT)
          .onClick(() => this.goHub())
        Text(this.routeTitle())
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(MOBILE_TEXT)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)
        // spacer to balance back
        Text('     ')
          .fontSize(15)
      }
      .width('100%')
      .padding({
        left: MOBILE_PAGE_GUTTER,
        right: MOBILE_PAGE_GUTTER,
        top: 12,
        bottom: 8,
      })

      Scroll() {
        Column() {
          if (this.route === MeRoute.ACCOUNT_INFO) {
            this.accountInfoBody()
          } else if (this.route === MeRoute.SECURITY) {
            this.securityBody()
          } else if (this.route === MeRoute.PREFS) {
            this.prefsBody()
          } else if (this.route === MeRoute.AUTH) {
            this.authBody()
          } else if (this.route === MeRoute.PERMS) {
            this.permsBody()
          } else if (this.route === MeRoute.ROBOTS) {
            this.emptyListBody('暂无机器人。鸿蒙端列表需 Gateway 会话；可到员工工作台查看。')
          } else if (this.route === MeRoute.GROUPS) {
            this.emptyListBody('暂无协作小组。鸿蒙端列表需 Gateway 会话；可到员工工作台查看。')
          }
        }
        .padding({
          left: MOBILE_PAGE_GUTTER,
          right: MOBILE_PAGE_GUTTER,
          bottom: MOBILE_PAGE_VERTICAL,
        })
        .width('100%')
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  build() {
    Column() {
      if (this.route === MeRoute.HUB) {
        this.hubBody()
      } else {
        this.secondaryBody()
      }
    }
    .width('100%')
    .height('100%')
  }
}
