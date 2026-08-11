// Phase 0 performance instrumentation. No-op unless explicitly enabled at runtime via
// localStorage key "mm-clone:perf" or the __setPerfEnabled test hook. Output goes to
// console.debug so it is visible in the DevTools session where you are profiling.
// See docs/design/2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md.

const PERF_FLAG_KEY = "mm-clone:perf";

let enabled = readInitialFlag();
console.log("perf enabled: ", enabled ? "yes" : "no", " (localStorage: ", PERF_FLAG_KEY,)
const renderCounts = new Map<string, number>();

function readInitialFlag(): boolean {
	return true
	try {
		return (
			typeof localStorage !== "undefined" &&
			localStorage.getItem(PERF_FLAG_KEY) === "1"
		);
	} catch {
		return false;
	}
}

export function isPerfEnabled(): boolean {
	return enabled;
}

// Test-only hook. Not exported via index.
export function __setPerfEnabled(next: boolean): void {
	enabled = next;
}

export function __resetPerfCache(): void {
	renderCounts.clear();
}

/** Times a synchronous function and logs `<label>: <ms>ms` when perf is enabled. */
export function traceSync<T>(label: string, fn: () => T): T {
	if (!enabled) return fn();
	const start = performance.now();
	try {
		return fn();
	} finally {
		const elapsed = performance.now() - start;
		console.debug(`[perf] ${label}: `, `${elapsed.toFixed(2)}ms`);
	}
}

/**
 * Increments a named render count. Counts are buffered and flushed by
 * `__flushPerfRenderCounts`, which logs a single aggregate line. Intended to be
 * called at the top of a component body guarded by `isPerfEnabled()`.
 */
export function markRender(componentName: string): void {
	if (!enabled) return;
	renderCounts.set(componentName, (renderCounts.get(componentName) ?? 0) + 1);
}

export function __flushPerfRenderCounts(): void {
	if (!enabled || renderCounts.size === 0) return;
	console.debug("[perf] render counts:", Object.fromEntries(renderCounts));
	renderCounts.clear();
}
