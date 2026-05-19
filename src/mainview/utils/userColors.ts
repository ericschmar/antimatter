const USER_COLOR_PALETTE = [
	"#7dd3fc",
	"#fda4af",
	"#86efac",
	"#fcd34d",
	"#c4b5fd",
	"#f9a8d4",
	"#5eead4",
	"#fdba74",
	"#a5b4fc",
	"#bef264",
	"#f0abfc",
	"#93c5fd",
	"#fb7185",
	"#38bdf8",
	"#4ade80",
	"#facc15",
	"#a78bfa",
	"#f472b6",
	"#2dd4bf",
	"#fb923c",
	"#818cf8",
	"#a3e635",
	"#e879f9",
	"#60a5fa",
	"#f87171",
	"#22d3ee",
	"#34d399",
	"#eab308",
	"#c084fc",
	"#ec4899",
	"#14b8a6",
	"#f97316",
	"#6366f1",
	"#84cc16",
	"#d946ef",
	"#3b82f6",
];

export const USER_COLOR_PALETTE_VERSION = "2";

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
