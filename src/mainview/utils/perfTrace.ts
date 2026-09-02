// Phase 0 performance instrumentation. No-op unless explicitly enabled at runtime via
// localStorage key "mm-clone:perf" or the __setPerfEnabled test hook. Output goes to
// console.debug so it is visible in the DevTools session where you are profiling.
// See docs/design/2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md.

const PERF_FLAG_KEY = "mm-clone:perf";

let enabled = readInitialFlag();
const renderCounts = new Map<string, number>();

function readInitialFlag(): boolean {
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

export function traceEvent(label: string): void {
	if (!enabled) return;
	console.debug(`[perf] ${label}`);
}

export function startTraceSpan(label: string): () => void {
	if (!enabled) return () => undefined;
	const start = performance.now();
	return () => {
		const elapsed = performance.now() - start;
		console.debug(`[perf] ${label}: `, `${elapsed.toFixed(2)}ms`);
	};
}

/**
 * Times an async operation without changing its result or error behavior.
 * Metadata is kept separate from the label so DevTools can group the metric.
 */
export async function traceAsync<T>(
	label: string,
	metadata: Record<string, unknown>,
	fn: () => Promise<T>,
): Promise<T> {
	if (!enabled) return fn();
	const start = performance.now();
	try {
		const result = await fn();
		console.debug(`[perf] ${label}: `, {
			...metadata,
			durationMs: Number((performance.now() - start).toFixed(2)),
			outcome: "success",
		});
		return result;
	} catch (error) {
		console.debug(`[perf] ${label}: `, {
			...metadata,
			durationMs: Number((performance.now() - start).toFixed(2)),
			outcome: "error",
		});
		throw error;
	}
}

/**
 * Reports main-thread tasks that exceed the browser's long-task threshold
 * (normally 50ms). Safari/WebKit does not currently expose this API, so this
 * remains a safe no-op there.
 */
export function observeLongTasks(): () => void {
	if (
		!enabled ||
		typeof PerformanceObserver === "undefined" ||
		!PerformanceObserver.supportedEntryTypes?.includes("longtask")
	)
		return () => undefined;

	const observer = new PerformanceObserver((entries) => {
		for (const entry of entries.getEntries())
			console.debug("[perf] longTask: ", {
				durationMs: Number(entry.duration.toFixed(2)),
				startTimeMs: Number(entry.startTime.toFixed(2)),
			});
	});
	observer.observe({ type: "longtask", buffered: true });
	return () => observer.disconnect();
}

/** Removes query values and opaque resource identifiers from a route in logs. */
export function sanitizePerfRoute(path: string): string {
	return path.replace(/\?.*$/, "").replace(/\/[a-z0-9]{10,}/gi, "/:id");
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
