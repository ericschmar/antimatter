import { describe, expect, mock, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { MattermostConfig } from "../types";

mock.module("../app/rpc", () => ({
	electrobun: { rpc: null },
}));

const { AuthScreen } = await import("./AuthScreen");

const savedSsoConfig: MattermostConfig = {
	serverUrl: "https://chat.example.com",
	token: "token-sso",
	authMethod: "sso",
};

function renderAuthScreen(
	defaultConfig: MattermostConfig | null,
	defaultConfigSource: "env" | "saved" = "saved",
) {
	return renderToString(
		<AuthScreen
			busy={false}
			defaultConfig={defaultConfig}
			defaultConfigSource={defaultConfigSource}
			error={null}
			onConnect={async () => {}}
			onPasswordLogin={async () => {}}
			onSsoLogin={async () => {}}
		/>,
	);
}

describe("AuthScreen saved connection", () => {
	test("displays the saved server URL and selects the saved SSO auth method", () => {
		const html = renderAuthScreen(savedSsoConfig);

		expect(html).toContain("Saved connection");
		expect(html).toContain("https://chat.example.com");
		expect(html).toContain("SSO");
		expect(html).toMatch(/aria-selected="true"[^>]*>\s*SSO\s*</);
		expect(html).toMatch(/aria-selected="false"[^>]*>\s*Token\s*</);
		expect(html).toContain('value="https://chat.example.com"');
	});

	test("selects the saved password auth method", () => {
		const html = renderAuthScreen({
			serverUrl: "https://chat.example.com",
			token: "token-password",
			authMethod: "password",
		});

		expect(html).toMatch(/aria-selected="true"[^>]*>\s*Password\s*</);
		expect(html).toContain('autoComplete="current-password"');
	});

	test("keeps the .env note for env-sourced credentials", () => {
		const html = renderAuthScreen(
			{ serverUrl: "https://env.example.com", token: "token-env" },
			"env",
		);

		expect(html).toContain("Loaded local Mattermost credentials from .env.");
		expect(html).not.toContain("Saved connection");
	});

	test("shows no connection note without a default config", () => {
		const html = renderAuthScreen(null);

		expect(html).not.toContain("auth-note");
		expect(html).toMatch(/aria-selected="true"[^>]*>\s*Token\s*</);
	});
});
