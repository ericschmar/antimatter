import { afterEach, describe, expect, test } from "bun:test";
import { getEnvConfig } from "./mattermostHttp";

const originalServerUrl = Bun.env["MATTERMOST_SERVER_URL"];
const originalLegacyUrl = Bun.env["MATTERMOST_URL"];
const originalPat = Bun.env["MATTERMOST_PAT"];

afterEach(() => {
	restoreEnv("MATTERMOST_SERVER_URL", originalServerUrl);
	restoreEnv("MATTERMOST_URL", originalLegacyUrl);
	restoreEnv("MATTERMOST_PAT", originalPat);
});

describe("getEnvConfig", () => {
	test("prefers MATTERMOST_SERVER_URL", () => {
		Bun.env["MATTERMOST_SERVER_URL"] = "https://server.example.com";
		Bun.env["MATTERMOST_URL"] = "https://legacy.example.com";
		Bun.env["MATTERMOST_PAT"] = "token";

		expect(getEnvConfig()).toEqual({
			serverUrl: "https://server.example.com",
			token: "token",
		});
	});

	test("accepts MATTERMOST_URL as a legacy alias", () => {
		delete Bun.env["MATTERMOST_SERVER_URL"];
		Bun.env["MATTERMOST_URL"] = "https://legacy.example.com";
		Bun.env["MATTERMOST_PAT"] = "token";

		expect(getEnvConfig()).toEqual({
			serverUrl: "https://legacy.example.com",
			token: "token",
		});
	});
});

function restoreEnv(key: string, value: string | undefined) {
	if (value === undefined) delete Bun.env[key];
	else Bun.env[key] = value;
}
