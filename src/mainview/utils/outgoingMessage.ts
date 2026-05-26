const TRAILING_ENCODED_SPACE_PATTERN = /(?:(?:&#x20;)|(?:&#32;)|(?:&nbsp;)|\s)+$/gi;

export function normalizeOutgoingMessage(message: string) {
	return message.replace(TRAILING_ENCODED_SPACE_PATTERN, "");
}
