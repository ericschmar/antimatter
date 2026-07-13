export type MentionMatch = {
	query: string;
	start: number;
};

export function matchMentionQuery(message: string): MentionMatch | null {
	const normalizedMessage = message
		.replace(/\u00a0/g, " ")
		.replace(/\u200b/g, "");
	const match = /(^|\s)@([A-Za-z0-9._-]*)[\r\n]*$/.exec(normalizedMessage);
	if (!match) return null;
	return {
		query: match[2] ?? "",
		start: match.index + (match[1]?.length ?? 0),
	};
}

export function buildMentionInsertion(
	message: string,
	mentionMatch: MentionMatch,
	username: string,
) {
	const nextMessage = `${message.slice(0, mentionMatch.start)}@${username} `;
	return { message: nextMessage, cursorPosition: nextMessage.length };
}
