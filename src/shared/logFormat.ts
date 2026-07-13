export const LOG_FILENAME = "antimatter.log";

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function formatLogLine(
	now: number,
	tag: string,
	args: unknown[],
): string {
	return `${new Date(now).toISOString()} [${tag}] ${args.map(stringify).join(" ")}\n`;
}
