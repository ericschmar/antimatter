import { defineConfig } from "@playwright/test";

export default defineConfig({
	expect: { timeout: 5_000 },
	projects: [
		{
			name: "webkit",
			use: { browserName: "webkit" },
		},
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
	reporter: [["list"]],
	retries: 0,
	testDir: "tests/e2e",
	testMatch: "**/*.e2e.ts",
	timeout: 30_000,
	use: {
		baseURL: "http://127.0.0.1:4511",
		viewport: { height: 800, width: 1100 },
	},
	webServer: {
		command: "bun tests/e2e/server.ts",
		reuseExistingServer: true,
		timeout: 120_000,
		url: "http://127.0.0.1:4511",
	},
	workers: 1,
});
