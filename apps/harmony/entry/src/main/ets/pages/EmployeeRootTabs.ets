import {
  EMPLOYEE_KNOWLEDGE_PATH,
  EMPLOYEE_OVERVIEW_PATH,
  EMPLOYEE_TASKS_PATH,
} from '../common/OpenBotConfig';
import {
  MOBILE_ACCENT,
  MOBILE_BG_BOTTOM,
  MOBILE_BG_MID,
  MOBILE_BG_TOP,
  MOBILE_BORDER,
  MOBILE_TEXT_TERTIARY,
} from '../common/MobileUiTokens';
import { EmployeeShellPage } from './EmployeeShellPage';
import { EmployeeWebEmbed } from './EmployeeWebEmbed';
import { MeTabPage } from './MeTabPage';

class HomeTabItem {
  id: string = '';
  label: string = '';
  glyph: string = '';
}

function buildTabs(): HomeTabItem[] {
  const chat = new HomeTabItem();
  chat.id = 'chat';
  chat.label = '对话';
  chat.glyph = '💬';
  const tasks = new HomeTabItem();
  tasks.id = 'tasks';
  tasks.label = '任务';
  tasks.glyph = '☑';
  const knowledge = new HomeTabItem();
  knowledge.id = 'knowledge';
  knowledge.label = '知识';
  knowledge.glyph = '📖';
  const me = new HomeTabItem();
  me.id = 'me';
  me.label = '我的';
  me.glyph = '👤';
  return [chat, tasks, knowledge, me];
}

/**
 * Post-login four-tab companion: 对话 / 任务 / 知识 / 我的.
 * Visual + IA SoT: Android PostOnboardingTabs. Me is native; Chat/Tasks/Knowledge
 * use employee Web embeds until ArkTS hosts full Gateway surfaces.
 */
@Component
export struct EmployeeRootTabs {
  @Prop gatewayBaseUrl: string = '';
  @Prop cookieValue: string = '';
  @Prop displayName: string = '';
  @Prop email: string = '';
  onSessionExpired: () => void = () => {};
  onLogoutComplete: () => void = () => {};

  @State private activeTab: string = 'chat';
  @State private showWorkbench: boolean = false;
  private readonly tabs: HomeTabItem[] = buildTabs();

  @Builder
  tabItem(tab: HomeTabItem) {
    Column({ space: 2 }) {
      Text(tab.glyph)
        .fontSize(20)
        .fontColor(this.activeTab === tab.id ? MOBILE_ACCENT : MOBILE_TEXT_TERTIARY)
      Text(tab.label)
        .fontSize(11)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.activeTab === tab.id ? MOBILE_ACCENT : MOBILE_TEXT_TERTIARY)
    }
    .layoutWeight(1)
    .height(58)
    .justifyContent(FlexAlign.Center)
    .borderRadius(16)
    .backgroundColor(this.activeTab === tab.id ? '#142F6BFF' : Color.Transparent)
    .onClick(() => {
      this.activeTab = tab.id;
    })
  }

  @Builder
  bottomTabBar() {
    Row({ space: 6 }) {
      ForEach(this.tabs, (tab: HomeTabItem) => {
        this.tabItem(tab)
      }, (tab: HomeTabItem) => tab.id)
    }
    .width('100%')
    .padding({ left: 10, right: 10, top: 10, bottom: 10 })
    .backgroundColor(Color.White)
    .border({ width: { top: 1, left: 0, right: 0, bottom: 0 }, color: MOBILE_BORDER })
  }

  build() {
    Stack() {
      Column() {
        // Tab bodies
        Column() {
          if (this.activeTab === 'chat') {
            EmployeeWebEmbed({
              gatewayBaseUrl: this.gatewayBaseUrl,
              cookieValue: this.cookieValue,
              targetPath: EMPLOYEE_OVERVIEW_PATH,
              title: '对话',
              onSessionExpired: () => {
                this.onSessionExpired();
              },
            })
          } else if (this.activeTab === 'tasks') {
            EmployeeWebEmbed({
              gatewayBaseUrl: this.gatewayBaseUrl,
              cookieValue: this.cookieValue,
              targetPath: EMPLOYEE_TASKS_PATH,
              title: '任务',
              onSessionExpired: () => {
                this.onSessionExpired();
              },
            })
          } else if (this.activeTab === 'knowledge') {
            EmployeeWebEmbed({
              gatewayBaseUrl: this.gatewayBaseUrl,
              cookieValue: this.cookieValue,
              targetPath: EMPLOYEE_KNOWLEDGE_PATH,
              title: '知识',
              onSessionExpired: () => {
                this.onSessionExpired();
              },
            })
          } else {
            MeTabPage({
              displayName: this.displayName,
              email: this.email,
              gatewayBaseUrl: this.gatewayBaseUrl,
              cookieValue: this.cookieValue,
              onOpenEmployeeWorkbench: () => {
                this.showWorkbench = true;
              },
            })
          }
        }
        .width('100%')
        .layoutWeight(1)

        this.bottomTabBar()
      }
      .width('100%')
      .height('100%')
      .linearGradient({
        angle: 180,
        colors: [[MOBILE_BG_TOP, 0], [MOBILE_BG_MID, 0.45], [MOBILE_BG_BOTTOM, 1]],
      })

      if (this.showWorkbench) {
        Column() {
          EmployeeShellPage({
            gatewayBaseUrl: this.gatewayBaseUrl,
            cookieValue: this.cookieValue,
            displayName: this.displayName,
            workbenchOverlay: true,
            onCloseWorkbench: () => {
              this.showWorkbench = false;
            },
            onSessionExpired: () => {
              this.showWorkbench = false;
              this.onSessionExpired();
            },
            onLogoutComplete: () => {
              this.showWorkbench = false;
              this.onLogoutComplete();
            },
          })
        }
        .width('100%')
        .height('100%')
        .backgroundColor(Color.Black)
      }
    }
    .width('100%')
    .height('100%')
  }
}
