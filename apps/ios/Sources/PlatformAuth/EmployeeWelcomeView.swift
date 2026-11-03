import SwiftUI

/// First-install welcome — aligns with Android `EmployeeWelcomeScreen`.
/// Shown once before `PlatformAuthView`; `AppStorage("employee.welcome.seen")`.
struct EmployeeWelcomeView: View {
    var onContinue: () -> Void

    var body: some View {
        ZStack {
            PlatformAuthPalette.background.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                VStack(spacing: 16) {
                    Text("欢迎使用 OpenBot")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(PlatformAuthPalette.ink)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    Text("面向团队的 AI 工作台")
                        .font(.system(size: 15))
                        .foregroundStyle(PlatformAuthPalette.muted)
                        .multilineTextAlignment(.center)
                    VStack(alignment: .leading, spacing: 12) {
                        welcomePoint("创建你的数字员工团队，让他们协助你工作")
                        welcomePoint("任务、知识与协作都在同一个 App 里")
                    }
                    .padding(.top, 8)
                    .frame(maxWidth: 420)
                }
                .padding(.horizontal, 28)
                Spacer(minLength: 24)
                Button(action: self.onContinue) {
                    Text("开始使用")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(PlatformAuthPalette.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 28)
                .padding(.bottom, 28)
                .accessibilityLabel("开始使用")
            }
        }
    }

    private func welcomePoint(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(PlatformAuthPalette.accent)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(PlatformAuthPalette.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}
