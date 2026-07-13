import { access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	MattermostAttachmentOpenRequest,
	MattermostAttachmentOpenResponse,
	MattermostEnvConfig,
	MattermostFileUploadRequest,
	MattermostLoginRequest,
	MattermostRpcRequest,
} from "../shared/electrobunRpc";

declare const __ANTIMATTER_GIPHY_API_KEY__: string | undefined;

export function getEnvConfig(): MattermostEnvConfig | null {
	const serverUrl =
		Bun.env["MATTERMOST_SERVER_URL"]?.trim() ??
		Bun.env["MATTERMOST_URL"]?.trim();
	const token = Bun.env["MATTERMOST_PAT"]?.trim();
	const giphyApiKey = Bun.env["GIPHY_API_KEY"]?.trim() ?? getBuildGiphyApiKey();

	if (!serverUrl && !token && !giphyApiKey) return null;
	return {
		...(giphyApiKey ? { giphyApiKey } : {}),
		...(serverUrl && token ? { serverUrl, token } : {}),
	};
}

function getBuildGiphyApiKey() {
	if (typeof __ANTIMATTER_GIPHY_API_KEY__ === "undefined") return undefined;
	return __ANTIMATTER_GIPHY_API_KEY__.trim() || undefined;
}

export async function mattermostRequest(request: MattermostRpcRequest) {
	const url = new URL(
		`/api/v4${request.path}`,
		normalizeServerUrl(request.serverUrl),
	);
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
	const url = new URL(
		"/api/v4/users/login",
		normalizeServerUrl(request.serverUrl),
	);
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
		token:
			response.headers.get("Token") ??
			response.headers.get("token") ??
			undefined,
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
		throw new Error(
			getMattermostErrorMessage(
				body,
				response.status,
				"Mattermost login failed",
			),
		);
	}
	return token;
}

export async function uploadMattermostFiles(
	request: MattermostFileUploadRequest,
) {
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

export async function openMattermostAttachment(
	request: MattermostAttachmentOpenRequest,
	openPath: (path: string) => boolean,
	tempRoot = join(tmpdir(), "antimatter-attachments"),
): Promise<MattermostAttachmentOpenResponse> {
	try {
		const filePath = await getMattermostAttachmentPath(request, tempRoot);
		if (!openPath(filePath)) {
			return {
				success: false,
				path: filePath,
				message: "Could not open attachment with the default application.",
			};
		}
		return { success: true, path: filePath };
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error ? error.message : "Could not open attachment.",
		};
	}
}

export async function downloadMattermostAttachment(
	request: MattermostAttachmentOpenRequest,
	tempRoot = join(tmpdir(), "antimatter-attachments"),
) {
	await mkdir(tempRoot, { recursive: true });
	const url = new URL(
		`/api/v4/files/${encodeURIComponent(request.fileId)}`,
		normalizeServerUrl(request.serverUrl),
	);
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${request.token}`,
		},
	});

	if (!response.ok) {
		const body = await readBody(response);
		throw new Error(
			getMattermostErrorMessage(
				body,
				response.status,
				"Attachment download failed",
			),
		);
	}

	const filePath = attachmentPath(request, tempRoot);
	await Bun.write(filePath, new Uint8Array(await response.arrayBuffer()));
	return filePath;
}

async function getMattermostAttachmentPath(
	request: MattermostAttachmentOpenRequest,
	tempRoot: string,
) {
	const filePath = attachmentPath(request, tempRoot);
	if (await fileExists(filePath)) return filePath;
	return downloadMattermostAttachment(request, tempRoot);
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
	const contentType =
		response.headers.get("Content-Type") ?? "application/octet-stream";
	const bytes = await response.arrayBuffer();
	return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function dataUrlToBlob(dataUrl: string, fallbackType: string) {
	const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
	if (!match)
		return new Blob([dataUrl], {
			type: fallbackType || "application/octet-stream",
		});
	const contentType = match[1] || fallbackType || "application/octet-stream";
	const encoded = match[3] ?? "";
	if (match[2]) {
		return new Blob([Buffer.from(encoded, "base64")], { type: contentType });
	}
	return new Blob([decodeURIComponent(encoded)], { type: contentType });
}

function getMattermostErrorMessage(
	body: unknown,
	status: number,
	fallback = "Request failed",
) {
	return body && typeof body === "object" && "message" in body
		? String((body as { message?: unknown }).message)
		: `${fallback} with ${status}.`;
}

function attachmentFileName(request: MattermostAttachmentOpenRequest) {
	const safeId = sanitizeFileSegment(request.fileId) || "attachment";
	const safeName =
		sanitizeFileSegment(request.fileName ?? "") || fallbackFileName(request);
	return `${safeId}-${safeName}`;
}

function attachmentPath(
	request: MattermostAttachmentOpenRequest,
	tempRoot: string,
) {
	return join(tempRoot, attachmentFileName(request));
}

async function fileExists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function fallbackFileName(request: MattermostAttachmentOpenRequest) {
	const extension = extensionForMimeType(request.mimeType);
	return extension ? `attachment.${extension}` : "attachment";
}

function extensionForMimeType(mimeType?: string) {
	if (!mimeType) return "";
	const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
	if (normalized === "image/jpeg") return "jpg";
	if (normalized === "image/png") return "png";
	if (normalized === "image/gif") return "gif";
	if (normalized === "image/webp") return "webp";
	if (normalized === "application/pdf") return "pdf";
	if (normalized === "text/plain") return "txt";
	return "";
}

function sanitizeFileSegment(value: string) {
	return value
		.replace(/[<>:"/\\|?*]/g, "_")
		.replace(/[\u0000-\u001f]/g, "_")
		.replace(/\s+/g, " ")
		.replace(/^\.+|\.+$/g, "")
		.replace(/^_+|_+$/g, "")
		.trim()
		.slice(0, 180);
}

function readHeaders(response: Response) {
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});
	return headers;
}
