import SwiftUI
import UniformTypeIdentifiers

/// Callbacks for the four-tab companion composer. The message list stays on `OpenBotChatView`.
public struct OpenBotChatMobileChrome {
    public var onOpenKnowledge: () -> Void
    public var onMic: () -> Void

    public init(
        onOpenKnowledge: @escaping () -> Void,
        onMic: @escaping () -> Void)
    {
        self.onOpenKnowledge = onOpenKnowledge
        self.onMic = onMic
    }
}

/// Pink knowledge capsule + attachment capsules + pill composer.
/// Send becomes stop and calls `OpenBotChatViewModel.abort()` (`chat.abort`) while a run is in flight.
/// Mic is a callback into TalkMode — not in-bubble speech-to-text.
@MainActor
struct MobileCompanionComposer: View {
    @Bindable var viewModel: OpenBotChatViewModel
    let chrome: OpenBotChatMobileChrome

    @State private var importing = false

    private enum Palette {
        static let kbBackground = Color(red: 252 / 255, green: 232 / 255, blue: 230 / 255)
        static let kbActiveBackground = Color(red: 251 / 255, green: 213 / 255, blue: 208 / 255)
        static let kbRing = Color(red: 249 / 255, green: 168 / 255, blue: 160 / 255)
        static let kbValue = Color(red: 185 / 255, green: 28 / 255, blue: 28 / 255)
        static let sendRed = Color(red: 226 / 255, green: 59 / 255, blue: 59 / 255)
        static let sendRedDisabled = Color(red: 232 / 255, green: 160 / 255, blue: 160 / 255)
        static let ink = Color(red: 24 / 255, green: 24 / 255, blue: 27 / 255)
        static let label = Color(red: 63 / 255, green: 63 / 255, blue: 70 / 255)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            self.knowledgeCapsule
                .padding(.bottom, 8)

            if !self.viewModel.attachments.isEmpty {
                self.attachmentCapsules
                    .padding(.bottom, 8)
            }

            self.pill
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .fileImporter(
            isPresented: self.$importing,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true)
        { result in
            self.ingest(result)
        }
    }

    private var knowledgeCapsule: some View {
        let summary = self.viewModel.contextSourceSummary
        let active = summary != nil
        return Button(action: self.chrome.onOpenKnowledge) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                Text("知识库")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(Palette.label)
                if let summary {
                    Text(summary)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Palette.kbValue)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(active ? Palette.kbActiveBackground : Palette.kbBackground)
            .clipShape(Capsule())
            .overlay {
                if active {
                    Capsule().strokeBorder(Palette.kbRing, lineWidth: 1.5)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("知识库")
    }

    private var attachmentCapsules: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(self.viewModel.attachments, id: \.id) { attachment in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(attachment.fileName)
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(1)
                            Text(attachment.type == "image" ? "图片" : "文件")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        Button {
                            self.viewModel.removeAttachment(attachment.id)
                        } label: {
                            Text("×")
                                .font(.system(size: 12, weight: .bold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Color.white))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("移除附件")
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(Color(red: 232 / 255, green: 240 / 255, blue: 255 / 255)))
                }
            }
        }
    }

    private var pill: some View {
        let sendBusy = self.viewModel.pendingRunCount > 0
        let canSend = self.viewModel.canSend && self.viewModel.healthOK
        return HStack(spacing: 4) {
            Button {
                self.importing = true
            } label: {
                Image(systemName: "paperclip")
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .disabled(sendBusy)
            .accessibilityLabel("添加附件")

            TextField("继续输入消息...", text: self.$viewModel.input, axis: .vertical)
                .lineLimit(1 ... 4)
                .font(.system(size: 15, weight: .medium))
                .disabled(sendBusy)

            Button {
                self.chrome.onMic()
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .disabled(sendBusy)
            .accessibilityLabel("语音输入")

            Button {
                if sendBusy {
                    self.viewModel.abort()
                } else {
                    self.viewModel.send()
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(sendBusy || canSend ? Palette.sendRed : Palette.sendRedDisabled)
                        .frame(width: 32, height: 32)
                    if self.viewModel.isAborting {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                    } else if sendBusy {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(Color.white)
                            .frame(width: 12, height: 12)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(!(canSend || sendBusy) || self.viewModel.isAborting)
            .accessibilityLabel(sendBusy ? "停止" : "发送")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(Color.white)
                .overlay(Capsule().strokeBorder(Color(red: 229 / 255, green: 231 / 255, blue: 236 / 255)))
                .shadow(color: .black.opacity(0.06), radius: 8, y: 2))
    }

    private func ingest(_ result: Result<[URL], Error>) {
        switch result {
        case let .success(urls):
            for url in urls {
                let accessed = url.startAccessingSecurityScopedResource()
                defer {
                    if accessed {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                do {
                    let data = try Data(contentsOf: url)
                    let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream"
                    self.viewModel.addImageAttachment(
                        data: data,
                        fileName: url.lastPathComponent,
                        mimeType: mime)
                } catch {
                    self.viewModel.errorText = error.localizedDescription
                }
            }
        case let .failure(error):
            self.viewModel.errorText = error.localizedDescription
        }
    }
}
