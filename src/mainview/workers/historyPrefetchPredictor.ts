import type { HistoryPrefetchCandidate } from "./chatHistoryProtocol";

export type HistoryPrefetchPredictor = {
	recordVisit: (channelId: string, at: number) => void;
	rank: (
		currentChannelId: string | undefined,
		candidates: HistoryPrefetchCandidate[],
		at: number,
	) => string[];
};

const TRANSITION_WEIGHT = 4;
const UNREAD_WEIGHT = 4;
const TYPING_WEIGHT = 1;
const TIME_OF_DAY_WEIGHT = 0.5;
const EMA_ALPHA = 0.2;

export function createHistoryPrefetchPredictor(): HistoryPrefetchPredictor {
	const transitions = new Map<string, Map<string, number>>();
	const hourlyVisits = new Map<string, Map<number, number>>();
	let previousChannelId: string | undefined;

	function recordVisit(channelId: string, at: number): void {
		if (previousChannelId && previousChannelId !== channelId) {
			const nextChannels = transitions.get(previousChannelId) ?? new Map();
			nextChannels.set(channelId, (nextChannels.get(channelId) ?? 0) + 1);
			transitions.set(previousChannelId, nextChannels);
		}
		previousChannelId = channelId;

		const hour = new Date(at).getHours();
		const visitsByHour = hourlyVisits.get(channelId) ?? new Map();
		const previousValue = visitsByHour.get(hour) ?? 0;
		visitsByHour.set(hour, previousValue + EMA_ALPHA * (1 - previousValue));
		hourlyVisits.set(channelId, visitsByHour);
	}

	function rank(
		currentChannelId: string | undefined,
		candidates: HistoryPrefetchCandidate[],
		at: number,
	): string[] {
		const transitionCounts = currentChannelId
			? (transitions.get(currentChannelId) ?? new Map())
			: new Map<string, number>();
		let transitionTotal = 0;
		for (const count of transitionCounts.values()) transitionTotal += count;
		const hour = new Date(at).getHours();
		let highestTimeScore = 0;
		for (const candidate of candidates) {
			highestTimeScore = Math.max(
				highestTimeScore,
				hourlyVisits.get(candidate.channelId)?.get(hour) ?? 0,
			);
		}

		return candidates
			.filter((candidate) => candidate.channelId !== currentChannelId)
			.map((candidate) => {
				const transitionScore = transitionTotal
					? (transitionCounts.get(candidate.channelId) ?? 0) / transitionTotal
					: 0;
				const unreadScore = candidate.mention ? 1 : candidate.unread ? 0.7 : 0;
				const typingScore = candidate.typing ? 1 : 0;
				const timeScore = highestTimeScore
					? (hourlyVisits.get(candidate.channelId)?.get(hour) ?? 0) /
						highestTimeScore
					: 0;
				return {
					channelId: candidate.channelId,
					score:
						TRANSITION_WEIGHT * transitionScore +
						UNREAD_WEIGHT * unreadScore +
						TYPING_WEIGHT * typingScore +
						TIME_OF_DAY_WEIGHT * timeScore,
				};
			})
			.sort(
				(left, right) =>
					right.score - left.score ||
					left.channelId.localeCompare(right.channelId),
			)
			.slice(0, 2)
			.map((candidate) => candidate.channelId);
	}

	return { recordVisit, rank };
}
