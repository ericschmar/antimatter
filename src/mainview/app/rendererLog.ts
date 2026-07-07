import { formatLogLine } from "../../shared/logFormat";

export type RendererLogSend = (payload: { line: string }) => void;

// Formats a renderer log line (bun-compatible) and forwards it to bun, which
// appends it to the shared log file. Kept free of heavy imports so its unit
// test does not load the editor/view runtime. See issue antimatter-vkb.
export function rendererLogVia(
	send: RendererLogSend,
	tag: string,
	args: unknown[],
	now: number = Date.now(),
): void {
	send({ line: formatLogLine(now, tag, args) });
}
