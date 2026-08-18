import {
	HISTORY_PRIORITY_ORDER,
	type HistoryPriority,
} from "./chatHistoryProtocol";

type QueuedLoadTask = {
	channelId: string;
	priority: HistoryPriority;
	run: () => void | Promise<void>;
};

export type LoadQueue = {
	add: (task: QueuedLoadTask) => void;
};

export function createLoadQueue(
	options: { maxConcurrent?: number } = {},
): LoadQueue {
	const maxConcurrent = options.maxConcurrent ?? 2;
	const queued: QueuedLoadTask[] = [];
	const runningChannels = new Set<string>();
	let runningCount = 0;

	function pump(): void {
		while (runningCount < maxConcurrent && queued.length > 0) {
			queued.sort(
				(a, b) =>
					HISTORY_PRIORITY_ORDER[a.priority] -
					HISTORY_PRIORITY_ORDER[b.priority],
			);
			const task = queued.shift();
			if (!task) return;
			runningCount += 1;
			runningChannels.add(task.channelId);
			void Promise.resolve(task.run())
				.catch(() => undefined)
				.finally(() => {
					runningCount -= 1;
					runningChannels.delete(task.channelId);
					pump();
				});
		}
	}

	return {
		add(task) {
			// Same channel already running: the caller re-issues the load when
			// the running one lands, so a duplicate run is wasted work.
			if (runningChannels.has(task.channelId)) return;
			const existingIndex = queued.findIndex(
				(candidate) => candidate.channelId === task.channelId,
			);
			if (existingIndex >= 0) {
				const existing = queued[existingIndex];
				if (
					HISTORY_PRIORITY_ORDER[task.priority] <
					HISTORY_PRIORITY_ORDER[existing.priority]
				) {
					queued[existingIndex] = task;
				}
				return;
			}
			queued.push(task);
			pump();
		},
	};
}
