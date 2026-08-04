import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	MattermostApiClient,
	normalizeServerUrl,
	POLL_POST_TYPE,
} from "./mattermostApi";

describe("normalizeServerUrl", () => {
	test("adds https when the protocol is omitted", () => {
		expect(normalizeServerUrl("mattermost.example.com/")).toBe(
			"https://mattermost.example.com",
		);
	});

	test("preserves explicit http protocol", () => {
		expect(normalizeServerUrl("http://localhost:8065/")).toBe(
			"http://localhost:8065",
		);
	});
});

describe("MattermostApiClient", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("injects bearer authorization and builds v4 URLs", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ id: "user-id", username: "test" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com/",
			token: "secret-token",
		});

		await client.getCurrentUser();

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/users/me",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer secret-token",
				}),
			}),
		);
	});

	test("loads users by ids with the Mattermost bulk user endpoint", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify([{ id: "user-id", username: "sarah" }]), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.getUsersByIds(["user-id"]);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/users/ids",
			expect.objectContaining({
				body: JSON.stringify(["user-id"]),
				method: "POST",
			}),
		);
	});

	test("loads every page of user team channels", async () => {
		const firstPage = Array.from({ length: 200 }, (_, index) => ({
			display_name: `Channel ${index}`,
			id: `channel-${index}`,
			name: `channel-${index}`,
			team_id: "team-id",
			type: "O",
		}));
		const secondPage = [
			{
				display_name: "Channel 200",
				id: "channel-200",
				name: "channel-200",
				team_id: "team-id",
				type: "O",
			},
		];
		const fetchMock = mock((url: string) => {
			const body = url.includes("/teams/team-id/channels")
				? url.includes("page=0")
					? firstPage
					: secondPage
				: [];
			return Promise.resolve(
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		const channels = await client.getChannelsForUserTeam("user-id", "team-id");

		expect(channels).toHaveLength(201);
		expect(channels.at(-1)?.id).toBe("channel-200");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/users/user-id/teams/team-id/channels?page=0&per_page=200",
			expect.anything(),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/users/user-id/teams/team-id/channels?page=1&per_page=200",
			expect.anything(),
		);
	});

	test("includes DMs outside the selected team", async () => {
		const teamChannel = {
			display_name: "Town Square",
			id: "team-channel",
			name: "town-square",
			team_id: "team-id",
			type: "O",
		};
		const crossTeamDm = {
			display_name: "",
			id: "cross-team-dm",
			name: "current-user__other-team-user",
			team_id: "",
			type: "D",
		};
		const otherTeamChannel = {
			display_name: "Other Town Square",
			id: "other-team-channel",
			name: "other-town-square",
			team_id: "other-team-id",
			type: "O",
		};
		const fetchMock = mock((url: string) => {
			const body = url.includes("/teams/team-id/channels")
				? [teamChannel]
				: [crossTeamDm, otherTeamChannel];
			return Promise.resolve(
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		const channels = await client.getChannelsForUserTeam("user-id", "team-id");

		expect(channels.map((channel) => channel.id)).toEqual([
			"team-channel",
			"cross-team-dm",
		]);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/users/user-id/channels?page=0&per_page=200",
			expect.anything(),
		);
	});

	test("reports viewed channel activity", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ status: "OK" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.viewChannel("user-id", "channel-id", "previous-channel-id");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/channels/members/user-id/view",
			expect.objectContaining({
				body: JSON.stringify({
					channel_id: "channel-id",
					prev_channel_id: "previous-channel-id",
				}),
				method: "POST",
			}),
		);
	});

	test("adds reactions with Mattermost reaction payload shape", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ emoji_name: "thumbsup" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.addReaction("user-id", "post-id", "thumbsup");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/reactions",
			expect.objectContaining({
				body: JSON.stringify({
					user_id: "user-id",
					post_id: "post-id",
					emoji_name: "thumbsup",
				}),
				method: "POST",
			}),
		);
	});

	test("creates replies with a root id", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ id: "reply-id" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.createPost("channel-id", "reply body", "root-id");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/posts",
			expect.objectContaining({
				body: JSON.stringify({
					channel_id: "channel-id",
					message: "reply body",
					root_id: "root-id",
				}),
				method: "POST",
			}),
		);
	});

	test("creates custom posts for typed Mattermost messages", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ id: "post-id" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.createCustomPost({
			channelId: "channel-id",
			message: "📞 Voice call",
			type: "custom_webrtc_call",
			props: { action: "offer", sessionId: "session-id" },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/posts",
			expect.objectContaining({
				body: JSON.stringify({
					channel_id: "channel-id",
					message: "📞 Voice call",
					type: "custom_webrtc_call",
					props: { action: "offer", sessionId: "session-id" },
				}),
				method: "POST",
			}),
		);
	});

	test("creates custom replies with a root id", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ id: "post-id" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.createCustomPost({
			channelId: "channel-id",
			message: "📞 Voice call",
			rootId: "root-id",
			type: "custom_webrtc_call",
			props: { action: "offer", sessionId: "session-id" },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/posts",
			expect.objectContaining({
				body: JSON.stringify({
					channel_id: "channel-id",
					message: "📞 Voice call",
					root_id: "root-id",
					type: "custom_webrtc_call",
					props: { action: "offer", sessionId: "session-id" },
				}),
				method: "POST",
			}),
		);
	});

	test("creates poll posts with poll props", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ id: "post-id" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});
		const poll = {
			question: "Lunch?",
			options: [
				{ id: "option-1", text: "Pizza" },
				{ id: "option-2", text: "Sushi" },
			],
			votes: {},
		};

		await client.createPollPost("channel-id", poll);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/posts",
			expect.objectContaining({
				body: JSON.stringify({
					channel_id: "channel-id",
					message: "📊 Poll: Lunch?",
					type: POLL_POST_TYPE,
					props: { poll },
				}),
				method: "POST",
			}),
		);
	});

	test("patches post props only", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ id: "post-id" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.patchPostProps("post/id", {
			poll: {
				question: "Lunch?",
				options: [{ id: "option-1", text: "Pizza" }],
				votes: { "user-id": "option-1" },
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/posts/post%2Fid/patch",
			expect.objectContaining({
				body: JSON.stringify({
					props: {
						poll: {
							question: "Lunch?",
							options: [{ id: "option-1", text: "Pizza" }],
							votes: { "user-id": "option-1" },
						},
					},
				}),
				method: "PUT",
			}),
		);
	});

	test("searches team posts with Mattermost search payload shape", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ order: [], posts: {} }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.searchPosts("deploy notes", "team-id");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/teams/team-id/posts/search",
			expect.objectContaining({
				body: expect.stringContaining('"terms":"deploy notes"'),
				method: "POST",
			}),
		);
	});

	test("searches channels by team", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify([{ id: "channel-id" }]), {
					status: 201,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.searchChannels("team-id", "town");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/teams/team-id/channels/search",
			expect.objectContaining({
				body: JSON.stringify({ term: "town" }),
				method: "POST",
			}),
		);
	});

	test("loads Mattermost files as data URLs through the transport", async () => {
		const transport = mock(() =>
			Promise.resolve({
				body: "data:image/gif;base64,R0lGODlh",
				ok: true,
				status: 200,
			}),
		);
		const client = new MattermostApiClient(
			{
				serverUrl: "https://mattermost.example.com",
				token: "secret-token",
			},
			transport,
		);

		await expect(client.getFileDataUrl("/api/v4/files/file-id")).resolves.toBe(
			"data:image/gif;base64,R0lGODlh",
		);
		expect(transport).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "/files/file-id",
				responseType: "dataUrl",
			}),
		);
	});

	test("opens Mattermost attachments through the desktop transport", async () => {
		const openTransport = mock(() =>
			Promise.resolve({
				path: "/tmp/report.pdf",
				success: true,
			}),
		);
		const client = new MattermostApiClient(
			{
				serverUrl: "https://mattermost.example.com",
				token: "secret-token",
			},
			undefined,
			undefined,
			openTransport,
		);

		await expect(
			client.openAttachment({
				id: "file-id",
				mime_type: "application/pdf",
				name: "report.pdf",
			}),
		).resolves.toEqual({
			path: "/tmp/report.pdf",
			success: true,
		});
		expect(openTransport).toHaveBeenCalledWith({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
			fileId: "file-id",
			fileName: "report.pdf",
			mimeType: "application/pdf",
		});
	});

	test("removes reactions through the Mattermost reaction endpoint", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response(null, { status: 200 })),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.removeReaction("user-id", "post-id", "thumbsup");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/users/user-id/posts/post-id/reactions/thumbsup",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
	});

	test("deletes posts through the Mattermost post endpoint", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response(null, { status: 200 })),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = new MattermostApiClient({
			serverUrl: "https://mattermost.example.com",
			token: "secret-token",
		});

		await client.deletePost("post/id");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://mattermost.example.com/api/v4/posts/post%2Fid",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
	});
});
