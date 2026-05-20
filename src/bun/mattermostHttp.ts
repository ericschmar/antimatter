import type {
	MattermostFileUploadRequest,
	MattermostLoginRequest,
	MattermostRpcRequest,
} from "../shared/electrobunRpc";

export function getEnvConfig() {
	const serverUrl =
		Bun.env["MATTERMOST_SERVER_URL"]?.trim() ??
		Bun.env["MATTERMOST_URL"]?.trim();
	const token = Bun.env["MATTERMOST_PAT"]?.trim();

	if (!serverUrl || !token) return null;
	return { serverUrl, token };
}

export async function mattermostRequest(request: MattermostRpcRequest) {
	const url = new URL(`/api/v4${request.path}`, normalizeServerUrl(request.serverUrl));
	const response = await fetch(url, {
		method: request.method ?? "GET",
		headers: {
			Authorization: `Bearer ${request.token}`,
			...(request.body ? { "Content-Type": "application/json" } : {}),
		},
		body: request.body ? JSON.stringify(request.body) : undefined,
	});
	const headers = readHeaders(response);

	return {
		status: response.status,
		ok: response.ok,
		headers,
		body:
			request.responseType === "dataUrl" && response.ok
				? await readDataUrl(response)
				: await readBody(response),
	};
}

export async function mattermostLogin(request: MattermostLoginRequest) {
	const url = new URL("/api/v4/users/login", normalizeServerUrl(request.serverUrl));
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			login_id: request.loginId,
			password: request.password,
		}),
	});
	return {
		status: response.status,
		ok: response.ok,
		headers: readHeaders(response),
		token: response.headers.get("Token") ?? response.headers.get("token") ?? undefined,
		body: await readBody(response),
	};
}

export async function loginWithMattermostDesktopToken(
	serverUrl: string,
	serverToken: string,
) {
	const url = new URL("/api/v4/users/login/desktop_token", serverUrl);
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: serverToken,
			deviceId: "",
		}),
	});
	const token =
		response.headers.get("Token") ?? response.headers.get("token") ?? undefined;
	if (!response.ok || !token) {
		const body = await readBody(response);
		throw new Error(getMattermostErrorMessage(body, response.status));
	}
	return token;
}

export async function uploadMattermostFiles(request: MattermostFileUploadRequest) {
	const url = new URL("/api/v4/files", normalizeServerUrl(request.serverUrl));
	const form = new FormData();
	form.set("channel_id", request.channelId);
	for (const file of request.files) {
		form.append("client_ids", file.clientId);
		form.append("files", dataUrlToBlob(file.dataUrl, file.type), file.name);
	}

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${request.token}`,
		},
		body: form,
	});

	return {
		status: response.status,
		ok: response.ok,
		headers: readHeaders(response),
		body: await readBody(response),
	};
}

export function normalizeServerUrl(value: string) {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

async function readBody(response: Response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { message: text };
	}
}

async function readDataUrl(response: Response) {
	const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
	const bytes = await response.arrayBuffer();
	return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function dataUrlToBlob(dataUrl: string, fallbackType: string) {
	const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
	if (!match) return new Blob([dataUrl], { type: fallbackType || "application/octet-stream" });
	const contentType = match[1] || fallbackType || "application/octet-stream";
	const encoded = match[3] ?? "";
	if (match[2]) {
		return new Blob([Buffer.from(encoded, "base64")], { type: contentType });
	}
	return new Blob([decodeURIComponent(encoded)], { type: contentType });
}

function getMattermostErrorMessage(body: unknown, status: number) {
	return body && typeof body === "object" && "message" in body
		? String((body as { message?: unknown }).message)
		: `Mattermost login failed with ${status}.`;
}

function readHeaders(response: Response) {
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});
	return headers;
}
