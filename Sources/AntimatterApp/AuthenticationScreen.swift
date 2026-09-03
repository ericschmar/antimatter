import SwiftUI

struct AuthenticationScreen: View {
    @ObservedObject var model: AuthenticationViewModel

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("ANTIMATTER")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.8)
                Spacer()
            }
            .foregroundStyle(WorkspaceTheme.primaryText)
            .padding(.horizontal, 16)
            .frame(height: WorkspaceTheme.titleHeight)
            .background(WorkspaceTheme.sidebar)

            Spacer()

            VStack(alignment: .leading, spacing: 20) {
                Text("Connect to Mattermost")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)

                Picker("Authentication method", selection: $model.method) {
                    ForEach(AuthenticationViewModel.Method.allCases) { method in
                        Text(method.label).tag(method)
                    }
                }
                .labelsHidden()
                .pickerStyle(.segmented)

                GroupedFormCard {
                    FormTextField(
                        "Server URL",
                        text: $model.serverURL,
                        prompt: "https://mattermost.example.com"
                    )

                    if model.method == .password {
                        FormDivider()
                        FormTextField("Email or username", text: $model.loginID, prompt: "you@example.com")
                        FormDivider()
                        FormSecureField("Password", text: $model.password)
                    } else if model.method == .personalAccessToken {
                        FormDivider()
                        FormSecureField("Personal access token", text: $model.token)
                    }
                }

                if model.method == .saml {
                    Text("Continue in your browser to sign in with your organization’s SAML provider.")
                        .font(.system(size: 13))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }

                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 12))
                        .foregroundStyle(WorkspaceTheme.attention)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button(model.isWorking ? "Connecting…" : actionTitle) {
                    model.submit()
                }
                .buttonStyle(.borderedProminent)
                .tint(WorkspaceTheme.accent)
                .disabled(model.isWorking)
            }
            .frame(width: 360)

            Spacer()
        }
        .background(WorkspaceTheme.canvas)
        .preferredColorScheme(.dark)
    }

    private var actionTitle: String {
        switch model.method {
        case .personalAccessToken: "Connect"
        case .password: "Sign in"
        case .saml: "Sign in with SSO"
        }
    }
}

private extension View {
    func formaCard(_ pad: CGFloat = 18) -> some View {
        padding(pad)
            .background(Color(NSColor.windowBackgroundColor), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Color.primary.opacity(0.06), lineWidth: 1))
            .shadow(color: .black.opacity(0.05), radius: 14, x: 0, y: 6)
    }
}

private struct GroupedFormCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .formaCard(0)
    }
}

private struct FormDivider: View {
    var body: some View {
        Divider()
            .padding(.leading, 16)
    }
}

private struct FormTextField: View {
    let title: String
    @Binding var text: String
    let prompt: String

    init(_ title: String, text: Binding<String>, prompt: String) {
        self.title = title
        _text = text
        self.prompt = prompt
    }

    var body: some View {
        FormRow(title) {
            TextField("", text: $text, prompt: Text(prompt))
                .textFieldStyle(.plain)
                .accessibilityLabel(title)
        }
    }
}

private struct FormSecureField: View {
    let title: String
    @Binding var text: String

    init(_ title: String, text: Binding<String>) {
        self.title = title
        _text = text
    }

    var body: some View {
        FormRow(title) {
            SecureField("", text: $text)
                .textFieldStyle(.plain)
                .accessibilityLabel(title)
        }
    }
}

private struct FormRow<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 110, alignment: .leading)
            content
                .font(.system(size: 16))
                .foregroundStyle(WorkspaceTheme.secondaryText)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
    }
}
