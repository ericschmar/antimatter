import { expect, type Page, test } from "@playwright/test";

type TraceSample = {
	clientHeight: number;
	firstVisibleId: string | null;
	firstVisibleTop: number | null;
	rowCount: number;
	scrollHeight: number;
	scrollTop: number;
	t: number;
};

type Trace = {
	loadMoreCalls: number;
	samples: TraceSample[];
	scrollEvents: number;
};

type LastRowInfo = {
	distanceFromBottomPx: number;
	fullyInView: boolean;
	rowCount: number;
	viewportBottomGap: number;
};

type Anchor = {
	id: string | null;
	rowCount: number;
	viewportTop: number;
};

type Geometry = {
	clientHeight: number;
	scrollHeight: number;
	scrollTop: number;
};

const AT_BOTTOM_BUFFER = 96;
const ANCHOR_DRIFT_LIMIT = 24;
const FRAME_STALL_LIMIT = 150;
const UNIFORMITY_FLOOR = 6;

const harness = <T>(page: Page, expression: string) =>
	page.evaluate<T>(`(window.__harness && window.__harness.${expression})`);

/**
 * Screenshots the scroller and returns the standard deviation of luminance
 * across a 32x32 downsample. A painted timeline has text/color variance; a
 * blank (unpainted) scroller scores near zero.
 */
async function luminanceStddev(page: Page): Promise<number> {
	const buffer = await page.locator(".mui-message-list-scroller").screenshot();
	return page.evaluate(async (base64) => {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("screenshot decode failed"));
			image.src = `data:image/png;base64,${base64}`;
		});
		const canvas = document.createElement("canvas");
		canvas.width = 32;
		canvas.height = 32;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("no 2d context");
		context.drawImage(image, 0, 0, 32, 32);
		const { data } = context.getImageData(0, 0, 32, 32);
		const count = 32 * 32;
		let sum = 0;
		let sumOfSquares = 0;
		for (let i = 0; i < data.length; i += 4) {
			const luminance =
				0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
			sum += luminance;
			sumOfSquares += luminance * luminance;
		}
		const mean = sum / count;
		return Math.sqrt(Math.max(0, sumOfSquares / count - mean * mean));
	}, buffer.toString("base64"));
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.waitForFunction(
		"() => Boolean(window.__harness && window.__harness.ready())",
	);
});

test("scenario 1 (pin stability): stays at the bottom after images settle", async ({
	page,
}) => {
	const opened = await harness<{ rowCount: number }>(
		page,
		"openChannel({ postCount: 120, imageFraction: 0.3, imageDelayMs: 700 })",
	);
	expect(opened.rowCount).toBeGreaterThan(0);

	await harness(page, "scrollToBottom()");
	await page.waitForTimeout(100);
	const before = await harness<Geometry>(page, "getGeometry()");
	expect(
		before.scrollHeight - before.clientHeight - before.scrollTop,
	).toBeLessThanOrEqual(AT_BOTTOM_BUFFER);

	await harness(page, "resetTrace()");
	const settled = await harness<{ pending: number }>(page, "settleImages()");
	expect(settled.pending).toBe(0);

	await page.waitForTimeout(3000);
	const trace = await harness<Trace>(page, "getTrace()");
	expect(trace.samples.length).toBeGreaterThan(30);

	// A content commit that grows the list necessarily outruns the pin by one
	// frame (ResizeObserver -> scrollToBottom happens on the next frame), so
	// the assertion is on *sustained* departures, not single-frame transients:
	// no streak above the buffer may outlast 150ms, and the idle tail must end
	// parked at the bottom.
	const distances = trace.samples.map(
		(sample) => sample.scrollHeight - sample.clientHeight - sample.scrollTop,
	);
	let streakStart = -1;
	let worstStreakMs = 0;
	for (let i = 0; i < distances.length; i++) {
		if (distances[i] > AT_BOTTOM_BUFFER && streakStart < 0) {
			streakStart = i;
		}
		if (distances[i] <= AT_BOTTOM_BUFFER && streakStart >= 0) {
			worstStreakMs = Math.max(
				worstStreakMs,
				trace.samples[i].t - trace.samples[streakStart].t,
			);
			streakStart = -1;
		}
	}
	if (streakStart >= 0) {
		worstStreakMs =
			trace.samples[trace.samples.length - 1].t - trace.samples[streakStart].t;
	}
	const finalDistance = distances[distances.length - 1];
	console.log(
		`[scenario 1] samples=${trace.samples.length} worstStreakAboveBuffer=${worstStreakMs.toFixed(0)}ms finalDistance=${finalDistance.toFixed(1)}px`,
	);
	expect(worstStreakMs).toBeLessThanOrEqual(150);
	expect(finalDistance).toBeLessThanOrEqual(AT_BOTTOM_BUFFER);
});

test("scenario 1b (no coercion): does not scroll a user who is reading history", async ({
	page,
}) => {
	await harness(
		page,
		"openChannel({ postCount: 120, imageFraction: 0.3, imageDelayMs: 7000 })",
	);
	await harness(page, "scrollToBottom()");
	await page.waitForTimeout(50);
	// Jump into history, let the settle window expire, then resolve images.
	// `scrollTop` itself may move: native scroll anchoring compensates for
	// content growth above the viewport, which preserves the reading
	// position. Coercion would change WHAT the user is looking at — so the
	// assertion is on the visible row, not the scroll offset.
	const scroller = page.locator(".mui-message-list-scroller");
	await scroller.evaluate((element) => {
		element.scrollTop = Math.round(element.scrollHeight / 2);
	});
	const before = await harness<Anchor>(page, "getAnchor()");
	expect(before?.id).toBeTruthy();
	await page.waitForTimeout(2500);
	await harness(page, "settleImages()");
	await page.waitForTimeout(1000);
	const after = await harness<Anchor>(page, "getAnchor()");
	console.log(
		`[scenario 1b] beforeRow=${before?.id} beforeTop=${before?.viewportTop.toFixed(1)} afterRow=${after?.id} afterTop=${after?.viewportTop.toFixed(1)}`,
	);
	expect(after?.id).toBe(before?.id);
	expect(
		Math.abs((after?.viewportTop ?? 0) - (before?.viewportTop ?? 0)),
	).toBeLessThanOrEqual(AT_BOTTOM_BUFFER);
});

test("scenario 2 (open-at-bottom): last message in view within 1s and stays through settle", async ({
	page,
}) => {
	await harness(
		page,
		"openChannel({ postCount: 300, imageFraction: 0.3, imageDelayMs: 900 })",
	);

	await page.waitForFunction(
		"() => window.__harness.getLastRowInfo().fullyInView === true",
		null,
		{ timeout: 1000 },
	);

	await page.waitForTimeout(1600);
	const info = await harness<LastRowInfo>(page, "getLastRowInfo()");
	console.log(
		`[scenario 2] rowCount=${info.rowCount} fullyInView=${info.fullyInView} viewportBottomGap=${info.viewportBottomGap.toFixed(1)}px distanceFromBottom=${info.distanceFromBottomPx.toFixed(1)}px`,
	);
	expect(info.rowCount).toBeGreaterThan(0);
	expect(info.fullyInView).toBe(true);
	expect(info.viewportBottomGap).toBeLessThanOrEqual(AT_BOTTOM_BUFFER);
	expect(info.distanceFromBottomPx).toBeLessThanOrEqual(AT_BOTTOM_BUFFER);
});

test("scenario 3 (load-more integrity): no anchor drift, blank flash, frame stall, or eager second load", async ({
	page,
}) => {
	await harness(
		page,
		"openChannel({ postCount: 200, imageFraction: 0.1, imageDelayMs: 50 })",
	);
	await harness(page, "setLoadMorePlan({ count: 50, latencyMs: 400 })");

	const baselineUniformity = await luminanceStddev(page);
	expect(baselineUniformity).toBeGreaterThanOrEqual(UNIFORMITY_FLOOR);

	const triggered = await harness<{ attempts: number }>(
		page,
		"triggerLoadMore()",
	);
	expect(triggered.attempts).toBeGreaterThan(0);

	for (let i = 0; i < 5; i++) {
		await page.mouse.wheel(0, 160);
		await page.waitForTimeout(30);
	}
	const midLoadUniformity = await luminanceStddev(page);
	expect(midLoadUniformity).toBeGreaterThanOrEqual(UNIFORMITY_FLOOR);

	const anchor = await harness<Anchor>(page, "getAnchor()");
	expect(anchor?.id).toBeTruthy();

	await harness(page, "resetTrace()");
	await page.waitForFunction(
		"([rowCount]) => window.__harness.getRowCount() > rowCount",
		[anchor.rowCount],
		{ timeout: 3000 },
	);
	await page.waitForTimeout(250);

	const after = await harness<number | null>(
		page,
		`getAnchorViewportY(${JSON.stringify(anchor.id)})`,
	);
	expect(after).not.toBeNull();
	if (after === null) throw new Error("anchor row disappeared after prepend");
	const anchorDrift = Math.abs(after - anchor.viewportTop);
	console.log(`[scenario 3] anchorDrift=${anchorDrift.toFixed(1)}px`);
	expect(anchorDrift).toBeLessThanOrEqual(ANCHOR_DRIFT_LIMIT);

	const trace = await harness<Trace>(page, "getTrace()");
	expect(trace.samples.length).toBeGreaterThan(10);
	let maxFrameGap = 0;
	for (let i = 1; i < trace.samples.length; i++) {
		maxFrameGap = Math.max(
			maxFrameGap,
			trace.samples[i].t - trace.samples[i - 1].t,
		);
	}
	expect(maxFrameGap).toBeLessThanOrEqual(FRAME_STALL_LIMIT);
	console.log(
		`[scenario 3] maxFrameGap=${maxFrameGap.toFixed(0)}ms samples=${trace.samples.length} scrollEvents=${trace.scrollEvents}`,
	);

	for (let i = 0; i < 10; i++) {
		await page.mouse.wheel(0, 200);
		if (i % 3 === 2) {
			const uniformity = await luminanceStddev(page);
			expect(uniformity).toBeGreaterThanOrEqual(UNIFORMITY_FLOOR);
		}
		await page.waitForTimeout(30);
	}

	await page.waitForTimeout(800);
	const finalTrace = await harness<Trace>(page, "getTrace()");
	expect(finalTrace.loadMoreCalls).toBe(1);
});
