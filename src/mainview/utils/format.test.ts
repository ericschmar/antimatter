import { describe, expect, test } from "bun:test";
import type { MattermostChannel, MattermostUser } from "../types";
import { channelLabel, directChannelOtherUserId } from "./format";

const currentUser: MattermostUser = {
	first_name: "Sarah",
	id: "b8g35mohzpbq78xqyjhhwwxjmr",
	username: "sarah",
};

function directChannel(name: string): MattermostChannel {
	return {
		display_name: "",
		id: "channel-1",
		name,
		team_id: "",
		type: "D",
	};
}

describe("channelLabel", () => {
	test("labels a self direct message with the current user's name and self suffix", () => {
		const channel = directChannel(
			"b8g35mohzpbq78xqyjhhwwxjmr__b8g35mohzpbq78xqyjhhwwxjmr",
		);

		expect(
			channelLabel(channel, { [currentUser.id]: currentUser }, currentUser.id),
		).toBe("Sarah (You)");
	});
});

describe("directChannelOtherUserId", () => {
	test("returns the current user id for a self direct message", () => {
		const channel = directChannel(
			"b8g35mohzpbq78xqyjhhwwxjmr__b8g35mohzpbq78xqyjhhwwxjmr",
		);

		expect(directChannelOtherUserId(channel, currentUser.id)).toBe(
			currentUser.id,
		);
	});
});
