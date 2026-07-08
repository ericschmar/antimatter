export type SelectionRange = { start: number; end: number };
export type TransformResult = {
	message: string;
	selection: SelectionRange;
};

/** Wrap the current selection with markdown markers. */
export function wrapSelection(
	message: string,
	selection: SelectionRange,
	prefix: string,
	suffix: string,
): TransformResult {
	const { start, end } = selection;
	if (start === end) {
		const nextMessage = `${message.slice(0, start)}${prefix}${suffix}${message.slice(end)}`;
		const caret = start + prefix.length;
		return { message: nextMessage, selection: { start: caret, end: caret } };
	}
	const selected = message.slice(start, end);
	const nextMessage = `${message.slice(0, start)}${prefix}${selected}${suffix}${message.slice(end)}`;
	return {
		message: nextMessage,
		selection: { start: start + prefix.length, end: end + prefix.length },
	};
}

/** Toggle a line-prefix marker (heading, quote, list) on the current line. */
export function toggleLinePrefix(
	message: string,
	selection: SelectionRange,
	prefix: string,
): TransformResult {
	const { start } = selection;
	const lineStart = message.lastIndexOf("\n", start - 1) + 1;
	const newlineIndex = message.indexOf("\n", start);
	const lineEnd = newlineIndex === -1 ? message.length : newlineIndex;
	const line = message.slice(lineStart, lineEnd);
	const hasPrefix = line.startsWith(prefix);
	const nextLine = hasPrefix ? line.slice(prefix.length) : `${prefix}${line}`;
	const nextMessage = `${message.slice(0, lineStart)}${nextLine}${message.slice(lineEnd)}`;
	const caret = lineStart + nextLine.length;
	return { message: nextMessage, selection: { start: caret, end: caret } };
}

/** Insert a markdown link, using the selection as the link text. */
export function insertLink(
	message: string,
	selection: SelectionRange,
): TransformResult {
	const { start, end } = selection;
	const text = start !== end ? message.slice(start, end) : "text";
	const before = message.slice(0, start);
	const after = message.slice(end);
	const urlPlaceholder = "url";
	const head = `[${text}](`;
	const marker = `${head}${urlPlaceholder})`;
	const urlStart = before.length + head.length;
	const urlEnd = urlStart + urlPlaceholder.length;
	return {
		message: `${before}${marker}${after}`,
		selection: { start: urlStart, end: urlEnd },
	};
}
