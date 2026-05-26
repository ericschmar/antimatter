export const USER_COLOR_PALETTE = [
	"#7dd3fc",
	"#86efac",
	"#fcd34d",
	"#f87171",
	"#a78bfa",
	"#2dd4bf",
	"#fdba74",
	"#60a5fa",
	"#d8b4fe",
	"#bef264",
	"#fb7185",
	"#34d399",
	"#f59e0b",
	"#38bdf8",
	"#c084fc",
	"#4ade80",
	"#f472b6",
	"#fde047",
	"#5eead4",
	"#fca5a5",
	"#818cf8",
	"#a3e635",
	"#f0abfc",
	"#93c5fd",
	"#fb923c",
	"#22d3ee",
	"#e879f9",
	"#c4b5fd",
	"#10b981",
	"#eab308",
	"#fda4af",
	"#3b82f6",
	"#84cc16",
	"#d946ef",
	"#14b8a6",
	"#ef4444",
	"#f97316",
	"#06b6d4",
	"#8b5cf6",
	"#65a30d",
	"#db2777",
	"#0891b2",
	"#ca8a04",
	"#0f766e",
	"#be123c",
	"#7c3aed",
	"#ea580c",
];

export const USER_COLOR_PALETTE_VERSION = "3";
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
