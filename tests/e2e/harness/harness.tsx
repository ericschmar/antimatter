import * as Tooltip from "@radix-ui/react-tooltip";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MuiMessageTimeline } from "../../../src/mainview/components/mui-headless-timeline/MuiMessageTimeline";
import { chatDataActions } from "../../../src/mainview/state/chatDataStore";
import type { AppSettings, MattermostPost } from "../../../src/mainview/types";
import "../../../src/mainview/index.css";
import {
	fixtureChannel,
	imageStubForSrc,
	makeFixturePosts,
	makeFixtureUsers,
} from "./fixture";

const BASE_TIME = Date.UTC(2026, 0, 6, 9, 0, 0);

const harnessSettings: AppSettings = {
	devLoopback: false,
	fontFamily: "system",
	fontSize: 14,
	notificationPreference: "all",
	notificationSounds: true,
	ownMessageIndicatorColor: "#00aa00",
	showOwnMessageIndicators: true,
	showProfilePictures: true,
	theme: "default",
	useNewComposer: false,
};

type RunState = {
	imageEvery: number;
	nextNewerIndex: number;
	nextOlderIndex: number;
	posts: MattermostPost[];
	runId: string;
};

export type TraceSample = {
	clientHeight: number;
	firstVisibleId: string | null;
	firstVisibleTop: number | null;
	rowCount: number;
	scrollHeight: number;
	scrollTop: number;
	t: number;
};

const trace = {
	loadMoreCalls: 0,
	samples: [] as TraceSample[],
	scrollEvents: 0,
};

let loadMorePlan = { count: 0, latencyMs: 0 };
let imageDelayMs = 0;
let runCounter = 0;

type PendingImage = {
	resolve: (url: string) => void;
	settled: boolean;
	url: string;
};
const pendingImages = new Set<PendingImage>();

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function getScroller(): HTMLElement | null {
	return document.querySelector<HTMLElement>(".mui-message-list-scroller");
}

function getRows(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>("[data-message-list-row]")];
}

function stubResolveImageSrc(src: string): Promise<string> {
	const { url } = imageStubForSrc(src);
	return new Promise<string>((resolve) => {
		const pending: PendingImage = {
			resolve: (nextUrl) => {
				if (pending.settled) return;
				pending.settled = true;
				pendingImages.delete(pending);
				resolve(nextUrl);
			},
			settled: false,
			url,
		};
		pendingImages.add(pending);
		if (imageDelayMs > 0) {
			setTimeout(() => pending.resolve(url), imageDelayMs);
		} else {
			pending.resolve(url);
		}
	});
}

const seenScrollers = new WeakSet<Element>();
let samplerId = 0;

function snapshotOnce(): TraceSample | null {
	const scroller = getScroller();
	if (!scroller) return null;
	if (!seenScrollers.has(scroller)) {
		seenScrollers.add(scroller);
		scroller.addEventListener(
			"scroll",
			() => {
				trace.scrollEvents++;
			},
			{ passive: true },
		);
	}
	const rows = getRows();
	const scrollerTop = scroller.getBoundingClientRect().top;
	let firstVisibleId: string | null = null;
	let firstVisibleTop: number | null = null;
	for (const row of rows) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom > scrollerTop + 1) {
			firstVisibleId = row.dataset.messageId ?? null;
			firstVisibleTop = rect.top - scrollerTop;
			break;
		}
	}
	return {
		clientHeight: scroller.clientHeight,
		firstVisibleId,
		firstVisibleTop,
		rowCount: rows.length,
		scrollHeight: scroller.scrollHeight,
		scrollTop: scroller.scrollTop,
		t: performance.now(),
	};
}

function startSampler() {
	cancelAnimationFrame(samplerId);
	const step = () => {
		const sample = snapshotOnce();
		if (sample) {
			trace.samples.push(sample);
			if (trace.samples.length > 8000) {
				trace.samples.splice(0, trace.samples.length - 8000);
			}
		}
		samplerId = requestAnimationFrame(step);
	};
	samplerId = requestAnimationFrame(step);
}

function setLoadMorePlan(plan: { count: number; latencyMs: number }) {
	loadMorePlan = { count: plan.count, latencyMs: plan.latencyMs };
	return loadMorePlan;
}

function getGeometry() {
	const scroller = getScroller();
	if (!scroller) return null;
	return {
		clientHeight: scroller.clientHeight,
		scrollHeight: scroller.scrollHeight,
		scrollTop: scroller.scrollTop,
	};
}

function scrollToTop() {
	const scroller = getScroller();
	if (scroller) scroller.scrollTop = 0;
	return getGeometry();
}

function scrollToBottom() {
	const scroller = getScroller();
	if (scroller) scroller.scrollTop = scroller.scrollHeight;
	return getGeometry();
}

function getRowCount() {
	return getRows().length;
}

function snapshotAnchor() {
	const scroller = getScroller();
	if (!scroller) return null;
	const scrollerTop = scroller.getBoundingClientRect().top;
	const rows = getRows();
	for (const row of rows) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom > scrollerTop + 1) {
			return {
				id: row.dataset.messageId ?? null,
				rowCount: rows.length,
				viewportTop: rect.top - scrollerTop,
			};
		}
	}
	return null;
}

async function getAnchor() {
	let anchor = snapshotAnchor();
	for (let attempt = 0; attempt < 6; attempt++) {
		if (!anchor?.id) return anchor;
		await sleep(100);
		const next = snapshotAnchor();
		if (!next || next.id !== anchor.id) {
			anchor = next;
			continue;
		}
		if (Math.abs(next.viewportTop - anchor.viewportTop) < 2) return next;
		anchor = next;
	}
	return anchor;
}

function getAnchorViewportY(id: string) {
	const scroller = getScroller();
	const row = document.querySelector<HTMLElement>(
		`[data-message-id="${CSS.escape(id)}"]`,
	);
	if (!scroller || !row) return null;
	return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

function getLastRowInfo() {
	const scroller = getScroller();
	if (!scroller) return null;
	const rows = getRows();
	const last = rows[rows.length - 1];
	if (!last) return { rowCount: 0 };
	const scrollerRect = scroller.getBoundingClientRect();
	const rect = last.getBoundingClientRect();
	return {
		distanceFromBottomPx:
			scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
		fullyInView:
			rect.top >= scrollerRect.top - 0.5 &&
			rect.bottom <= scrollerRect.bottom + 0.5,
		rowCount: rows.length,
		viewportBottomGap: scrollerRect.bottom - rect.bottom,
	};
}

function resetTrace() {
	trace.samples.length = 0;
	trace.scrollEvents = 0;
}

function getTrace() {
	return {
		loadMoreCalls: trace.loadMoreCalls,
		samples: trace.samples.slice(),
		scrollEvents: trace.scrollEvents,
	};
}

function pendingImageCount() {
	return pendingImages.size;
}

async function settleImages() {
	for (const pending of [...pendingImages]) {
		pending.resolve(pending.url);
	}
	for (let attempt = 0; attempt < 20 && pendingImages.size > 0; attempt++) {
		await sleep(100);
	}
	await sleep(200);
	return { pending: pendingImages.size };
}

async function triggerLoadMore() {
	const callsBefore = trace.loadMoreCalls;
	const scroller = getScroller();
	if (!scroller) throw new Error("no scroller mounted");
	scroller.scrollTop = 0;
	for (let attempt = 0; attempt < 20; attempt++) {
		await sleep(150);
		if (trace.loadMoreCalls > callsBefore) return { attempts: attempt + 1 };
		scroller.scrollTop = 300;
		await sleep(60);
		scroller.scrollTop = 0;
	}
	throw new Error("onLoadMore never fired after reaching the top");
}

function appendMessages(setRun: SetRun, count: number) {
	setRun((prev) => {
		if (!prev) return prev;
		const newer = makeFixturePosts({
			baseTime: BASE_TIME,
			count,
			imageEvery: prev.imageEvery,
			runId: prev.runId,
			startIndex: prev.nextNewerIndex,
		});
		return {
			...prev,
			nextNewerIndex: prev.nextNewerIndex + count,
			posts: [...prev.posts, ...newer],
		};
	});
}

type SetRun = (update: (prev: RunState | null) => RunState | null) => void;

const noop = () => {};
const noopAsync = async () => {};

function HarnessApp() {
	const [run, setRun] = useState<RunState | null>(null);

	const handleLoadMore = useCallback(() => {
		trace.loadMoreCalls++;
		const plan = loadMorePlan;
		if (plan.count <= 0) return;
		setTimeout(() => {
			setRun((prev) => {
				if (!prev) return prev;
				const older = makeFixturePosts({
					baseTime: BASE_TIME,
					count: plan.count,
					imageEvery: prev.imageEvery,
					runId: prev.runId,
					startIndex: prev.nextOlderIndex - plan.count,
				});
				return {
					...prev,
					nextOlderIndex: prev.nextOlderIndex - plan.count,
					posts: [...older, ...prev.posts],
				};
			});
		}, plan.latencyMs);
	}, []);

	const openChannel = useCallback(
		async (options: {
			imageDelayMs: number;
			imageFraction: number;
			postCount: number;
		}) => {
			runCounter++;
			const runId = `r${runCounter}`;
			imageDelayMs = options.imageDelayMs;
			pendingImages.clear();
			trace.samples.length = 0;
			trace.scrollEvents = 0;
			trace.loadMoreCalls = 0;
			loadMorePlan = { count: 0, latencyMs: 0 };

			chatDataActions.resetForSignOut();
			const { currentUser, users } = makeFixtureUsers();
			chatDataActions.setCurrentUser(currentUser);
			chatDataActions.setUsers(users);
			chatDataActions.setSettings(harnessSettings);
			chatDataActions.setUserColors({});
			chatDataActions.setUserImages({});
			chatDataActions.setUserStatuses({});
			chatDataActions.setChannelHasMoreHistory(fixtureChannel.id, true);
			chatDataActions.setResolveImageSrc(stubResolveImageSrc);

			const imageEvery =
				options.imageFraction > 0
					? Math.max(1, Math.round(1 / options.imageFraction))
					: 0;
			const posts = makeFixturePosts({
				baseTime: BASE_TIME,
				count: options.postCount,
				imageEvery,
				runId,
				startIndex: 1000,
			});
			setRun({
				imageEvery,
				nextNewerIndex: 1000 + options.postCount,
				nextOlderIndex: 1000,
				posts,
				runId,
			});

			for (let attempt = 0; attempt < 100; attempt++) {
				if (getScroller() && getRows().length > 0) break;
				await sleep(50);
			}
			return { rowCount: getRows().length, runId };
		},
		[],
	);

	useEffect(() => {
		startSampler();
		const api = {
			appendMessages: (count: number) => appendMessages(setRun, count),
			getAnchor,
			getAnchorViewportY,
			getGeometry,
			getLastRowInfo,
			getRowCount,
			getTrace,
			openChannel,
			pendingImageCount,
			ready: () => true,
			resetTrace,
			scrollToBottom,
			scrollToTop,
			setLoadMorePlan,
			settleImages,
			triggerLoadMore,
		};
		(window as unknown as Record<string, unknown>).__harness = api;
	}, [openChannel]);

	return (
		<div className="harness-shell">
			{run ? (
				<Tooltip.Provider>
					<MuiMessageTimeline
						channel={fixtureChannel}
						channelId={fixtureChannel.id}
						loading={false}
						loadingHistory={false}
						onLoadMore={handleLoadMore}
						onOpenAttachment={noopAsync}
						onReply={noop}
						onSetUserColor={noop}
						onShowMessageContextMenu={noop}
						onStartDm={noop}
						onToggleReaction={noopAsync}
						onVotePoll={noopAsync}
						posts={run.posts}
						typingUsers={[]}
					/>
				</Tooltip.Provider>
			) : (
				<div className="harness-idle">
					Harness ready. Call window.__harness.openChannel().
				</div>
			)}
		</div>
	);
}

const rootElement = document.getElementById("harness-root");
if (rootElement) {
	createRoot(rootElement).render(<HarnessApp />);
}
