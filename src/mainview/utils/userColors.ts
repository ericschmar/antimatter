export const USER_COLOR_PALETTE = [
	"#151829",
	"#252c45",
	"#3c4b6b",
	"#596e8f",
	"#7293a6",
	"#95bac2",
	"#0b2566",
	"#12498c",
	"#1c7199",
	"#319fb0",
	"#86d9d5",
	"#0d323b",
	"#114d44",
	"#127a3e",
	"#5ab03f",
	"#b5d96c",
	"#590c25",
	"#9c2219",
	"#bd622a",
	"#e6ba39",
	"#eddc6b",
	"#300633",
	"#61135a",
	"#8f2b76",
	"#b04d8a",
	"#d17997",
	"#e0a2ad",
	"#732816",
	"#964a2c",
	"#ba7947",
	"#d9b484",
	"#fffece",
];

export const USER_COLOR_PALETTE_VERSION = "4";
const USER_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function colorForUserId(userId: string, usedColors = new Set<string>()) {
	let hash = 0;
	for (const character of userId) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	const paletteIndex = hash % USER_COLOR_PALETTE.length;
	for (let offset = 0; offset < USER_COLOR_PALETTE.length; offset += 1) {
		const color =
			USER_COLOR_PALETTE[(paletteIndex + offset) % USER_COLOR_PALETTE.length];
		if (!usedColors.has(color)) return color;
	}
	return USER_COLOR_PALETTE[paletteIndex];
}

export function normalizeUserColor(color: string) {
	const trimmed = color.trim();
	return USER_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}
