import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEnvConfig, openMattermostAttachment } from "./mattermostHttp";

const originalServerUrl = Bun.env["MATTERMOST_SERVER_URL"];
const originalLegacyUrl = Bun.env["MATTERMOST_URL"];
const originalPat = Bun.env["MATTERMOST_PAT"];
const originalFetch = globalThis.fetch;
const tempRoots: string[] = [];

afterEach(async () => {
	restoreEnv("MATTERMOST_SERVER_URL", originalServerUrl);
	restoreEnv("MATTERMOST_URL", originalLegacyUrl);
	restoreEnv("MATTERMOST_PAT", originalPat);
	globalThis.fetch = originalFetch;
	await Promise.all(
		tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { force: true, recursive: true })),
	);
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

describe("openMattermostAttachment", () => {
	test("downloads an authenticated Mattermost file and opens the saved path", async () => {
		const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			fetchCalls.push({ input, init });
			return Promise.resolve(
				new Response("pdf bytes", {
					status: 200,
					headers: { "Content-Type": "application/pdf" },
				}),
			);
		}) as typeof fetch;
		const openedPaths: string[] = [];
		const tempRoot = await mkdtemp(join(tmpdir(), "antimatter-attachment-test-"));
		tempRoots.push(tempRoot);

		const result = await openMattermostAttachment(
			{
				fileId: "file/id",
				fileName: "../Quarterly Report?.pdf",
				mimeType: "application/pdf",
				serverUrl: "https://mattermost.example.com/",
				token: "secret-token",
			},
			(path) => {
				openedPaths.push(path);
				return true;
			},
			tempRoot,
		);

		expect(result.success).toBe(true);
		if (!result.path) throw new Error("Expected attachment path.");
		expect(fetchCalls[0]?.input.toString()).toBe(
			"https://mattermost.example.com/api/v4/files/file%2Fid",
		);
		expect(fetchCalls[0]?.init?.headers).toEqual({
			Authorization: "Bearer secret-token",
		});
		expect(openedPaths).toEqual([result.path]);
		expect(result.path.endsWith("file_id-Quarterly Report_.pdf")).toBe(true);
		await expect(readFile(result.path, "utf8")).resolves.toBe("pdf bytes");
	});

	test("returns a failure response when the OS refuses to open the saved file", async () => {
		globalThis.fetch = (() =>
			Promise.resolve(new Response("hello", { status: 200 }))) as unknown as typeof fetch;
		const tempRoot = await mkdtemp(join(tmpdir(), "antimatter-attachment-test-"));
		tempRoots.push(tempRoot);

		const result = await openMattermostAttachment(
			{
				fileId: "file-id",
				serverUrl: "https://mattermost.example.com",
				token: "secret-token",
			},
			() => false,
			tempRoot,
		);

		expect(result).toEqual({
			success: false,
			path: result.path,
			message: "Could not open attachment with the default application.",
		});
	});

	test("opens a cached attachment without downloading it again", async () => {
		const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			fetchCalls.push({ input, init });
			return Promise.resolve(new Response("fresh bytes", { status: 200 }));
		}) as typeof fetch;
		const openedPaths: string[] = [];
		const tempRoot = await mkdtemp(join(tmpdir(), "antimatter-attachment-test-"));
		tempRoots.push(tempRoot);
		const cachedPath = join(tempRoot, "file-id-report.pdf");
		await writeFile(cachedPath, "cached bytes");

		const result = await openMattermostAttachment(
			{
				fileId: "file-id",
				fileName: "report.pdf",
				serverUrl: "https://mattermost.example.com",
				token: "secret-token",
			},
			(path) => {
				openedPaths.push(path);
				return true;
			},
			tempRoot,
		);

		expect(result).toEqual({
			success: true,
			path: cachedPath,
		});
		expect(fetchCalls).toHaveLength(0);
		expect(openedPaths).toEqual([cachedPath]);
		await expect(readFile(cachedPath, "utf8")).resolves.toBe("cached bytes");
	});
});

function restoreEnv(key: string, value: string | undefined) {
	if (value === undefined) delete Bun.env[key];
	else Bun.env[key] = value;
}
