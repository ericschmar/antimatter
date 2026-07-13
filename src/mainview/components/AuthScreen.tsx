import { CheckCircle2, KeyRound, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { MattermostSsoProvider } from "../../shared/electrobunRpc";
import { electrobun } from "../app/rpc";
import type { MattermostConfig } from "../types";
import { Titlebar } from "./Titlebar";
import "./AuthScreen.css";

export function AuthScreen({
	busy,
	defaultConfig,
	error,
	onConnect,
	onPasswordLogin,
	onSsoLogin,
}: {
	busy: boolean;
	defaultConfig: MattermostConfig | null;
	error: string | null;
	onConnect: (config: MattermostConfig) => Promise<void>;
	onPasswordLogin: (
		serverUrl: string,
		loginId: string,
		password: string,
	) => Promise<void>;
	onSsoLogin: (
		serverUrl: string,
		provider: MattermostSsoProvider,
	) => Promise<void>;
}) {
	const [serverUrl, setServerUrl] = useState(defaultConfig?.serverUrl ?? "");
	const [token, setToken] = useState(defaultConfig?.token ?? "");
	const [authMethod, setAuthMethod] = useState<"pat" | "password" | "sso">(
		"pat",
	);
	const [loginId, setLoginId] = useState("");
	const [password, setPassword] = useState("");

	useEffect(() => {
		if (!defaultConfig) return;
		setServerUrl(defaultConfig.serverUrl);
		setToken(defaultConfig.token);
	}, [defaultConfig]);

	return (
		<div className="window-shell">
			<Titlebar
				onWindowControl={(action) => {
					void electrobun.rpc?.request.windowControl({ action });
				}}
			/>
			<div className="auth-page">
				<form
					className="auth-panel"
					onSubmit={(event) => {
						event.preventDefault();
						if (authMethod === "password")
							void onPasswordLogin(serverUrl, loginId, password);
						else if (authMethod === "sso") void onSsoLogin(serverUrl, "saml");
						else void onConnect({ serverUrl, token, authMethod: "pat" });
					}}
				>
					{defaultConfig ? (
						<p className="auth-note">
							Loaded local Mattermost credentials from .env.
						</p>
					) : null}
					<div
						className="auth-methods"
						role="tablist"
						aria-label="Authentication method"
					>
						<button
							aria-selected={authMethod === "pat"}
							role="tab"
							type="button"
							onClick={() => setAuthMethod("pat")}
						>
							Token
						</button>
						<button
							aria-selected={authMethod === "password"}
							role="tab"
							type="button"
							onClick={() => setAuthMethod("password")}
						>
							Password
						</button>
						<button
							aria-selected={authMethod === "sso"}
							role="tab"
							type="button"
							onClick={() => setAuthMethod("sso")}
						>
							SSO
						</button>
					</div>
					<label>
						<span>Server URL</span>
						<input
							autoComplete="url"
							placeholder="https://mattermost.example.com"
							required
							type="text"
							value={serverUrl}
							onChange={(event) => setServerUrl(event.target.value)}
						/>
					</label>
					{authMethod === "password" ? (
						<>
							<label>
								<span>Email or username</span>
								<input
									autoComplete="username"
									placeholder="you@example.com"
									required
									type="text"
									value={loginId}
									onChange={(event) => setLoginId(event.target.value)}
								/>
							</label>
							<label>
								<span>Password</span>
								<input
									autoComplete="current-password"
									required
									type="password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
								/>
							</label>
						</>
					) : authMethod === "sso" ? null : (
						<label>
							<span>Personal access token</span>
							<input
								autoComplete="off"
								placeholder="Paste token"
								required
								type="password"
								value={token}
								onChange={(event) => setToken(event.target.value)}
							/>
						</label>
					)}
					{error ? <div className="form-error">{error}</div> : null}
					<button className="primary-action" disabled={busy} type="submit">
						{busy ? (
							<RefreshCcw className="spin" size={16} />
						) : authMethod === "sso" ? (
							<KeyRound size={16} />
						) : (
							<CheckCircle2 size={16} />
						)}
						{busy
							? "Connecting"
							: authMethod === "password"
								? "Sign in"
								: authMethod === "sso"
									? "Sign in with SSO"
									: "Connect"}
					</button>
				</form>
			</div>
		</div>
	);
}
