import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LOG_FILENAME, formatLogLine } from "../shared/logFormat";

export { LOG_FILENAME, formatLogLine };

export function appendLogLine(dir: string, line: string): void {
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, LOG_FILENAME), line);
}
