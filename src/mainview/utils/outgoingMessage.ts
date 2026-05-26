const TRAILING_ENCODED_SPACE_PATTERN = /(?:(?:&#x20;)|(?:&#32;)|(?:&nbsp;)|\s)+$/gi;
const BARE_HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s<]+/gi;
const URL_MARKDOWN_ESCAPE_PATTERN = /\\([!#$%&'()*+,\-./:;=?@[\\\]_~])/g;

export function normalizeOutgoingMessage(message: string) {
	return message
		.replace(BARE_HTTP_URL_PATTERN, (url) =>
			url.replace(URL_MARKDOWN_ESCAPE_PATTERN, "$1"),
		)
		.replace(TRAILING_ENCODED_SPACE_PATTERN, "");
}
