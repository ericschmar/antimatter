export const USER_COLOR_PALETTE = [
	"#0d0305",
	"#3c3444",
	"#6e576e",
	"#917d9b",
	"#c5b7cb",
	"#f7f4e8",
	"#5f4f47",
	"#851246",
	"#d72048",
	"#7d322f",
	"#9d4c2f",
	"#c65e2d",
	"#f96a2d",
	"#ffa300",
	"#e29138",
	"#f7c233",
	"#f9ec41",
	"#11442c",
	"#287a33",
	"#52b139",
	"#8ae931",
	"#0e131e",
	"#203c62",
	"#2a69b0",
	"#00a1de",
	"#6bdad5",
	"#a52eb8",
	"#f7406e",
	"#fc83a2",
	"#f9cf9d",
	"#fba176",
	"#f66f67",
];

export const USER_COLOR_PALETTE_VERSION = "5";
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
