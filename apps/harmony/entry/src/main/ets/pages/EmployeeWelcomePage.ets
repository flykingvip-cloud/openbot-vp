import { common } from '@kit.AbilityKit';
import { SessionStore } from '../platformauth/SessionStore';

/**
 * First-install welcome — aligns with Android EmployeeWelcomeScreen.
 * Shown once before LoginPage; upgrades with an existing session skip via SessionStore.
 */
@Component
export struct EmployeeWelcomePage {
  onContinue: () => void = () => {};

  private async markSeenAndContinue(): Promise<void> {
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      await SessionStore.setWelcomeSeen(ctx, true);
    } catch (_e) {
      // Prefer advancing over trapping the user on prefs failure.
    }
    this.onContinue();
  }

  build() {
    Column() {
      Blank().layoutWeight(1)

      Column({ space: 12 }) {
        Text('欢迎使用 OpenBot')
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor('#1C1917')
          .textAlign(TextAlign.Center)
          .width('100%')

        Text('面向团队的 AI 工作台')
          .fontSize(16)
          .fontColor('#78716C')
          .textAlign(TextAlign.Center)
          .width('100%')
          .margin({ top: 4 })

        Text('创建你的数字员工团队，让他们协助你工作')
          .fontSize(15)
          .fontColor('#44403C')
          .textAlign(TextAlign.Center)
          .width('100%')
          .margin({ top: 20 })
          .lineHeight(22)

        Text('任务、知识与协作都在同一个 App 里')
          .fontSize(15)
          .fontColor('#44403C')
          .textAlign(TextAlign.Center)
          .width('100%')
          .lineHeight(22)
      }
      .width('100%')
      .padding({ left: 28, right: 28 })

      Blank().layoutWeight(1)

      Button('开始使用')
        .width('100%')
        .height(50)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(Color.White)
        .backgroundColor('#8C6629')
        .borderRadius(14)
        .margin({ left: 28, right: 28, bottom: 40 })
        .onClick(() => {
          void this.markSeenAndContinue();
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F6F5F2')
  }
}
