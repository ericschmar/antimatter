import emojiMartData from "@emoji-mart/data";
import type { Emoji, EmojiMartData } from "@emoji-mart/data";

const emojiData = emojiMartData as EmojiMartData;
const emojiAliases = new Map<string, string>();

for (const [id, emoji] of Object.entries(emojiData.emojis)) {
	setEmojiAlias(id, id);
	for (const keyword of emoji.keywords) {
		setEmojiAlias(keyword, id);
	}
}

for (const [alias, id] of Object.entries(emojiData.aliases)) {
	setEmojiAlias(alias, id);
}

export function normalizeEmojiName(value: string) {
	const normalized = normalizeEmojiKey(value);
	return emojiAliases.get(normalized) ?? emojiAliases.get(normalized.replace(/_/g, "")) ?? normalized;
}

export function emojiNameToGlyph(name: string) {
	const emoji = findEmoji(name);
	return emoji?.skins[0]?.native ?? `:${name}:`;
}

function findEmoji(name: string): Emoji | undefined {
	const id = normalizeEmojiName(name);
	return emojiData.emojis[id];
}

function setEmojiAlias(value: string, id: string) {
	const normalized = normalizeEmojiKey(value);
	emojiAliases.set(normalized, id);
	emojiAliases.set(normalized.replace(/_/g, ""), id);
}

function normalizeEmojiKey(value: string) {
	const trimmed = value.toLowerCase().replace(/^:+|:+$/g, "");
	if (/^[+-]1$/.test(trimmed)) return trimmed;
	return trimmed
		.toLowerCase()
		.replace(/[\s-]+/g, "_")
		.replace(/[^a-z0-9_+-]/g, "");
}
