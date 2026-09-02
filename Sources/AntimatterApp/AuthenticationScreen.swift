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

                Field("Server URL", text: $model.serverURL, prompt: "https://mattermost.example.com")

                if model.method == .password {
                    Field("Email or username", text: $model.loginID, prompt: "you@example.com")
                    SecureField("Password", text: $model.password)
                        .textFieldStyle(.roundedBorder)
                } else if model.method == .personalAccessToken {
                    SecureField("Personal access token", text: $model.token)
                        .textFieldStyle(.roundedBorder)
                } else {
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

private struct Field: View {
    let title: String
    @Binding var text: String
    let prompt: String

    init(_ title: String, text: Binding<String>, prompt: String) {
        self.title = title
        _text = text
        self.prompt = prompt
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(WorkspaceTheme.primaryText)
            TextField("", text: $text, prompt: Text(prompt))
                .textFieldStyle(.roundedBorder)
        }
    }
}
