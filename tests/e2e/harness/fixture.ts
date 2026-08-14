import type {
	MattermostChannel,
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
} from "../../../src/mainview/types";

export const fixtureChannel: MattermostChannel = {
	display_name: "E2E Scroll",
	id: "channel-e2e",
	name: "e2e-scroll",
	team_id: "team-1",
	type: "O",
};

const fixtureUsernames = [
	"sarah",
	"alex",
	"jordan",
	"priya",
	"ken",
	"mia",
	"noah",
	"luna",
];

export const fixtureAuthorIds = [
	"user-current",
	"user-1",
	"user-2",
	"user-3",
	"user-4",
	"user-5",
	"user-6",
	"user-7",
];

export function makeFixtureUsers(): {
	currentUser: MattermostUser;
	users: Record<string, MattermostUser>;
} {
	const users: Record<string, MattermostUser> = {
		"user-current": { id: "user-current", username: fixtureUsernames[0] },
	};
	for (const index of fixtureUsernames.keys()) {
		if (index === 0) continue;
		const id = `user-${index}`;
		users[id] = { id, username: fixtureUsernames[index] };
	}
	return { currentUser: users["user-current"], users };
}

const IMAGE_DIMENSIONS: ReadonlyArray<readonly [number, number]> = [
	[640, 480],
	[800, 600],
	[1024, 768],
	[480, 640],
	[720, 720],
];

export function svgDataUrl(width: number, height: number, hue: number): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="hsl(${hue}, 45%, 30%)"/><circle cx="${Math.round(width / 2)}" cy="${Math.round(height / 2)}" r="${Math.round(Math.min(width, height) / 3)}" fill="hsl(${(hue + 90) % 360}, 60%, 55%)"/><rect x="8" y="8" width="${Math.max(4, Math.round(width / 12))}" height="${Math.max(4, Math.round(height / 12))}" fill="hsl(${(hue + 180) % 360}, 50%, 70%)"/></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Maps a `/files/<encoded file id>` src to a deterministic SVG data URL with
 * exact intrinsic dimensions, so image-driven layout shift is real without
 * any network I/O.
 */
export function imageStubForSrc(src: string): { url: string } {
	const fileId = decodeURIComponent(src.replace(/^\/files\//, ""));
	const parsed = Number.parseInt(fileId.split("-").pop() ?? "0", 10);
	const index = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
	const [width, height] = IMAGE_DIMENSIONS[index % IMAGE_DIMENSIONS.length];
	return { url: svgDataUrl(width, height, (index * 47) % 360) };
}

function messageBody(index: number): string {
	switch (Math.abs(index) % 6) {
		case 0:
			return `Status update ${index}: the render pass is green and the frame budget holds.`;
		case 1:
			return `Hey **@sarah**, the deploy notes for build ${index} need a second look before we cut the release.`;
		case 2:
			return `Snippet ${index}:

\`\`\`ts
const anchor = captureAnchor(rows);
restoreAnchor(anchor);
\`\`\``;
		case 3:
			return `Longer thought ${index}: we measured the commit window across three runs, and the tail latency stayed inside the budget even with markdown re-parsing enabled. The numbers are recorded in the appendix so the next investigation can compare against the same yardstick.`;
		case 4:
			return `Reaction check ${index} — looks good to me, shipping it.`;
		default:
			return `Note ${index}: pinned for later review.`;
	}
}

function imageFile(runId: string, index: number): MattermostFileInfo {
	return {
		extension: "png",
		has_preview_image: true,
		id: `file-${runId}-${index}`,
		mime_type: "image/png",
		name: `screenshot-${Math.abs(index)}.png`,
	};
}

export type FixturePostsOptions = {
	baseTime: number;
	count: number;
	imageEvery: number;
	runId: string;
	startIndex: number;
};

export function makeFixturePosts(
	options: FixturePostsOptions,
): MattermostPost[] {
	const posts: MattermostPost[] = [];
	for (let offset = 0; offset < options.count; offset++) {
		const index = options.startIndex + offset;
		const createAt =
			options.baseTime +
			Math.abs(index) * 3 * 60_000 +
			(Math.abs(index) % 60 === 0 ? 6 * 60 * 60_000 : 0);
		const files =
			options.imageEvery > 0 && Math.abs(index) % options.imageEvery === 0
				? [imageFile(options.runId, index)]
				: undefined;
		posts.push({
			channel_id: fixtureChannel.id,
			create_at: createAt,
			delete_at: 0,
			id: `post-${options.runId}-${index}`,
			message: messageBody(index),
			metadata: files ? { files } : undefined,
			update_at: createAt,
			user_id: fixtureAuthorIds[Math.abs(index) % fixtureAuthorIds.length],
		});
	}
	return posts;
}
