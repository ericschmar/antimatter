import { describe, expect, test } from "bun:test";
import {
	parseMattermostWebSocketMessage,
	readMattermostWebSocketEvent,
	readMattermostWebSocketStatus,
} from "./mattermostWebSocketEvents";

describe("mattermost websocket event parsing", () => {
	test("normalizes posted events", () => {
		const message = parseMattermostWebSocketMessage(
			JSON.stringify({
				event: "posted",
				data: {
					team_id: "team1",
					post: JSON.stringify({
						id: "post1",
						channel_id: "channel1",
						user_id: "user1",
						message: "hello",
					}),
				},
			}),
		);

		expect(message).not.toBeNull();
		expect(readMattermostWebSocketEvent(message!)).toEqual({
			type: "post",
			post: {
				id: "post1",
				channel_id: "channel1",
				user_id: "user1",
				message: "hello",
			},
			teamId: "team1",
		});
	});

	test("omits teamId for direct messages", () => {
		const message = parseMattermostWebSocketMessage(
			JSON.stringify({
				event: "posted",
				data: {
					team_id: "",
					post: JSON.stringify({
						id: "post2",
						channel_id: "channel2",
						user_id: "user2",
						message: "dm",
					}),
				},
			}),
		);

		expect(message).not.toBeNull();
		expect(readMattermostWebSocketEvent(message!)).toEqual({
			type: "post",
			post: {
				id: "post2",
				channel_id: "channel2",
				user_id: "user2",
				message: "dm",
			},
		});
	});

	test("normalizes reaction events", () => {
		const message = parseMattermostWebSocketMessage(
			JSON.stringify({
				event: "reaction_removed",
				data: {
					reaction: JSON.stringify({
						post_id: "post1",
						user_id: "user1",
						emoji_name: "thumbsup",
					}),
				},
			}),
		);

		expect(message).not.toBeNull();
		expect(readMattermostWebSocketEvent(message!)).toEqual({
			type: "reaction",
			reaction: {
				post_id: "post1",
				user_id: "user1",
				emoji_name: "thumbsup",
			},
			removed: true,
		});
	});

	test("reads authentication failures as status events", () => {
		const message = parseMattermostWebSocketMessage(
			JSON.stringify({
				status: "FAIL",
				error: "bad token",
			}),
		);

		expect(message).not.toBeNull();
		expect(readMattermostWebSocketStatus(message!, null)).toEqual({
			status: "error",
			message: "bad token",
		});
	});
});
