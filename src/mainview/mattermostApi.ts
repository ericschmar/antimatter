import type {
	MattermostChannelMember,
	MattermostChannel,
	MattermostConfig,
	MattermostFileInfo,
	MattermostFileUploadResponse,
	MattermostPost,
	MattermostReaction,
	MattermostTeam,
	MattermostUser,
	MattermostUserStatus,
	PostListResponse,
	PostSearchResponse,
} from "./types";
import type {
	MattermostFileUploadItem,
	MattermostRpcRequest,
	MattermostRpcResponse,
} from "../shared/electrobunRpc";

type RequestOptions = {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: unknown;
	responseType?: "json" | "dataUrl";
};

type MattermostTransport = (request: MattermostRpcRequest) => Promise<MattermostRpcResponse>;
type MattermostUploadTransport = (request: {
	serverUrl: string;
	token: string;
	channelId: string;
	files: MattermostFileUploadItem[];
}) => Promise<MattermostRpcResponse>;

type MattermostResponse<T> = {
	body: T;
	headers: Headers;
	status: number;
};

export type MattermostImageResolution = {
	apiPath: string | null;
	attemptedPaths: string[];
	contentType?: string;
	dataUrlLength?: number;
	error?: string;
	ok: boolean;
	originalSrc: string;
	src: string | null;
	status?: number;
};

export class MattermostApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "MattermostApiError";
		this.status = status;
	}
}

export class MattermostApiClient {
	private readonly serverUrl: string;
	private readonly token: string;
	private readonly transport?: MattermostTransport;
	private readonly uploadTransport?: MattermostUploadTransport;

	constructor(
		config: MattermostConfig,
		transport?: MattermostTransport,
		uploadTransport?: MattermostUploadTransport,
	) {
		this.serverUrl = normalizeServerUrl(config.serverUrl);
		this.token = config.token;
		this.transport = transport;
		this.uploadTransport = uploadTransport;
	}

	getBaseUrl() {
		return this.serverUrl;
	}

	getCurrentUser() {
		return this.request<MattermostUser>("/users/me");
	}

	getUsersByIds(userIds: string[]) {
		return this.request<MattermostUser[]>("/users/ids", {
			method: "POST",
			body: userIds,
		});
	}

	getUsersByUsernames(usernames: string[]) {
		return this.request<MattermostUser[]>("/users/usernames", {
			method: "POST",
			body: usernames,
		});
	}

	searchUsers(term: string, teamId?: string) {
		return this.request<MattermostUser[]>("/users/search", {
			method: "POST",
			body: {
				term,
				allow_inactive: false,
				...(teamId ? { team_id: teamId } : {}),
			},
		});
	}

	getStatusesByIds(userIds: string[]) {
		return this.request<MattermostUserStatus[]>("/users/status/ids", {
			method: "POST",
			body: userIds,
		});
	}

	getTeamsForCurrentUser() {
		return this.request<MattermostTeam[]>("/users/me/teams");
	}

	getChannelsForUserTeam(userId: string, teamId: string) {
		return this.request<MattermostChannel[]>(
			`/users/${encodeURIComponent(userId)}/teams/${encodeURIComponent(teamId)}/channels`,
		);
	}

	getChannel(channelId: string) {
		return this.request<MattermostChannel>(
			`/channels/${encodeURIComponent(channelId)}`,
		);
	}

	searchChannels(teamId: string, term: string) {
		return this.request<MattermostChannel[]>(
			`/teams/${encodeURIComponent(teamId)}/channels/search`,
			{
				method: "POST",
				body: { term },
			},
		);
	}

	createChannel(teamId: string, displayName: string, name: string, type: "O" | "P") {
		return this.request<MattermostChannel>("/channels", {
			method: "POST",
			body: {
				team_id: teamId,
				display_name: displayName,
				name,
				type,
			},
		});
	}

	createDirectChannel(userIds: string[]) {
		return this.request<MattermostChannel>("/channels/direct", {
			method: "POST",
			body: userIds,
		});
	}

	createGroupChannel(userIds: string[]) {
		return this.request<MattermostChannel>("/channels/group", {
			method: "POST",
			body: userIds,
		});
	}

	getChannelMembers(channelId: string) {
		return this.request<MattermostChannelMember[]>(
			`/channels/${encodeURIComponent(channelId)}/members`,
		);
	}

	addChannelMember(channelId: string, userId: string) {
		return this.request<MattermostChannelMember>(
			`/channels/${encodeURIComponent(channelId)}/members`,
			{
				method: "POST",
				body: { user_id: userId },
			},
		);
	}

	getPostsForChannel(channelId: string, page = 0, perPage = 60) {
		return this.request<PostListResponse>(
			`/channels/${encodeURIComponent(channelId)}/posts?page=${page}&per_page=${perPage}`,
		);
	}

	getPostsForChannelBefore(channelId: string, postId: string, perPage = 60) {
		return this.request<PostListResponse>(
			`/channels/${encodeURIComponent(channelId)}/posts?before=${encodeURIComponent(postId)}&per_page=${perPage}`,
		);
	}

	getPostThread(postId: string) {
		return this.request<PostListResponse>(
			`/posts/${encodeURIComponent(postId)}/thread`,
		);
	}

	searchPosts(terms: string, teamId?: string) {
		const path = teamId
			? `/teams/${encodeURIComponent(teamId)}/posts/search`
			: "/posts/search";
		return this.request<PostSearchResponse>(path, {
			method: "POST",
			body: {
				terms,
				is_or_search: false,
				time_zone_offset: new Date().getTimezoneOffset(),
				page: 0,
				per_page: 12,
			},
		});
	}

	async getFileDataUrl(filePathOrUrl: string) {
		const resolution = await this.resolveFileImage(filePathOrUrl);
		if (!resolution.ok || !resolution.src) {
			throw new MattermostApiError(resolution.status ?? 0, resolution.error ?? "Could not load image.");
		}
		return resolution.src;
	}

	async resolveFileImage(filePathOrUrl: string | string[]): Promise<MattermostImageResolution> {
		const originalSrc = Array.isArray(filePathOrUrl) ? filePathOrUrl[0] ?? "" : filePathOrUrl;
		const candidates = Array.isArray(filePathOrUrl) ? filePathOrUrl : [filePathOrUrl];
		const attemptedPaths: string[] = [];
		let lastFailure: MattermostImageResolution | null = null;

		for (const candidate of candidates) {
			const paths = this.toMattermostApiPaths(candidate);
			if (paths.length === 0) {
				return {
					apiPath: null,
					attemptedPaths,
					ok: true,
					originalSrc,
					src: candidate,
				};
			}

			for (const path of paths) {
				attemptedPaths.push(path);
				try {
					const response = await this.requestWithResponse<string>(path, { responseType: "dataUrl" });
					const dataUrl = response.body;
					return {
						apiPath: path,
						attemptedPaths: [...attemptedPaths],
						contentType: response.headers.get("content-type") ?? readDataUrlContentType(dataUrl),
						dataUrlLength: dataUrl.length,
						ok: true,
						originalSrc,
						src: dataUrl,
						status: response.status,
					};
				} catch (error) {
					lastFailure = {
						apiPath: path,
						attemptedPaths: [...attemptedPaths],
						error: error instanceof Error ? error.message : "Could not load image.",
						ok: false,
						originalSrc,
						src: null,
						status: error instanceof MattermostApiError ? error.status : undefined,
					};
				}
			}
		}

		return lastFailure ?? {
			apiPath: null,
			attemptedPaths,
			error: "No image source provided.",
			ok: false,
			originalSrc,
			src: null,
		};
	}

	createPost(channelId: string, message: string, rootId?: string) {
		return this.request<MattermostPost>("/posts", {
			method: "POST",
			body: { channel_id: channelId, message, ...(rootId ? { root_id: rootId } : {}) },
		});
	}

	createPostWithFiles(channelId: string, message: string, fileIds: string[], rootId?: string) {
		return this.request<MattermostPost>("/posts", {
			method: "POST",
			body: {
				channel_id: channelId,
				file_ids: fileIds,
				message,
				...(rootId ? { root_id: rootId } : {}),
			},
		});
	}

	updatePost(postId: string, message: string) {
		return this.request<MattermostPost>(
			`/posts/${encodeURIComponent(postId)}/patch`,
			{
				method: "PUT",
				body: { message },
			},
		);
	}

	uploadFiles(channelId: string, files: MattermostFileUploadItem[]) {
		if (this.uploadTransport) {
			return this.uploadTransport({
				serverUrl: this.serverUrl,
				token: this.token,
				channelId,
				files,
			}).then((response) => {
				if (!response.ok) {
					throw new MattermostApiError(response.status, readRpcError(response.body, response.status));
				}
				return response.body as MattermostFileUploadResponse;
			});
		}
		throw new MattermostApiError(0, "File upload requires the desktop transport.");
	}

	getReactionsForPost(postId: string) {
		return this.request<MattermostReaction[]>(
			`/posts/${encodeURIComponent(postId)}/reactions`,
		);
	}

	addReaction(userId: string, postId: string, emojiName: string) {
		return this.request<MattermostReaction>("/reactions", {
			method: "POST",
			body: {
				user_id: userId,
				post_id: postId,
				emoji_name: emojiName,
			},
		});
	}

	removeReaction(userId: string, postId: string, emojiName: string) {
		return this.request<unknown>(
			`/users/${encodeURIComponent(userId)}/posts/${encodeURIComponent(
				postId,
			)}/reactions/${encodeURIComponent(emojiName)}`,
			{ method: "DELETE" },
		);
	}

	private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
		const response = await this.requestWithResponse<T>(path, options);
		return response.body;
	}

	private async requestWithResponse<T>(path: string, options: RequestOptions = {}): Promise<MattermostResponse<T>> {
		if (this.transport) {
			const response = await this.transport({
				serverUrl: this.serverUrl,
				token: this.token,
				path,
				method: options.method ?? "GET",
				body: options.body,
				responseType: options.responseType,
			});

			if (!response.ok) {
				throw new MattermostApiError(response.status, readRpcError(response.body, response.status));
			}

			return {
				body: response.body as T,
				headers: new Headers(response.headers),
				status: response.status,
			};
		}

		const response = await fetch(`${this.serverUrl}/api/v4${path}`, {
			method: options.method ?? "GET",
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		});

		if (!response.ok) {
			throw new MattermostApiError(response.status, await readError(response));
		}

		if (options.responseType === "dataUrl") {
			const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
			const blob = await response.blob();
			return {
				body: await blobToDataUrl(blob, contentType) as T,
				headers: response.headers,
				status: response.status,
			};
		}

		const text = await response.text();
		if (!text) {
			return {
				body: null as T,
				headers: response.headers,
				status: response.status,
			};
		}

		return {
			body: JSON.parse(text) as T,
			headers: response.headers,
			status: response.status,
		};
	}

	private toMattermostApiPaths(filePathOrUrl: string) {
		if (!filePathOrUrl || /^(data|blob):/i.test(filePathOrUrl)) return [];

		try {
			const url = new URL(filePathOrUrl, this.serverUrl);
			const serverUrl = new URL(this.serverUrl);
			if (url.origin !== serverUrl.origin) return [];
			const search = url.search || "";
			if (url.pathname.startsWith("/api/v4/")) return [`${url.pathname.slice("/api/v4".length)}${search}`];
			if (url.pathname.startsWith("/users/")) return [`${url.pathname}${search}`];
			if (url.pathname.startsWith("/files/")) return [`${url.pathname}${search}`];
			return [];
		} catch {
			return [];
		}
	}
}

export function getMattermostFileImagePaths(file: MattermostFileInfo) {
	const fileId = encodeURIComponent(file.id);
	const paths = file.has_preview_image
		? [`/files/${fileId}/preview`, `/files/${fileId}`]
		: [`/files/${fileId}`];
	return paths;
}

function blobToDataUrl(blob: Blob, contentType: string) {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			const result = reader.result;
			if (typeof result === "string") resolve(result);
			else reject(new Error(`Could not read ${contentType} response.`));
		});
		reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file.")));
		reader.readAsDataURL(blob);
	});
}

function readRpcError(body: unknown, status: number) {
	if (body && typeof body === "object") {
		const maybeError = body as { message?: unknown; error?: unknown };
		if (typeof maybeError.message === "string") return maybeError.message;
		if (typeof maybeError.error === "string") return maybeError.error;
	}

	return `Request failed with ${status}`;
}

function readDataUrlContentType(value: string) {
	const match = /^data:([^;,]+)/i.exec(value);
	return match?.[1];
}

export function normalizeServerUrl(value: string) {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (!trimmed) return "";
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

async function readError(response: Response) {
	try {
		const body = (await response.json()) as { message?: string; error?: string };
		return body.message ?? body.error ?? `Request failed with ${response.status}`;
	} catch {
		return `Request failed with ${response.status}`;
	}
}
