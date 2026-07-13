import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { formatLogLine, LOG_FILENAME } from "../shared/logFormat";

export { formatLogLine, LOG_FILENAME };

export function appendLogLine(dir: string, line: string): void {
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, LOG_FILENAME), line);
}
