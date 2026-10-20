import SwiftUI

/// Shared page header — Android `MobilePageHeader` / HTML `.module-title`.
struct ModuleTitle: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.title)
                .font(OpenBotMobileTokens.moduleTitle())
                .foregroundStyle(OpenBotMobileTokens.text)
                .accessibilityAddTraits(.isHeader)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(OpenBotMobileTokens.callout())
                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// HTML SoT `.seg` control: white track + 1px line; active = accent fill / white label.
struct SoTSegmentedControl: View {
    let options: [String]
    @Binding var selectedIndex: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(self.options.enumerated()), id: \.offset) { index, label in
                let selected = index == self.selectedIndex
                Button {
                    self.selectedIndex = index
                } label: {
                    Text(label)
                        .font(OpenBotMobileTokens.caption1(selected ? .bold : .medium))
                        .foregroundStyle(selected ? Color.white : OpenBotMobileTokens.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(selected ? OpenBotMobileTokens.accent : Color.clear)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
    }
}
