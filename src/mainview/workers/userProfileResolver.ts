import type { MattermostApiClient } from "../mattermostApi";
import type { MattermostUser } from "../types";

export type UserProfileResolver = {
	resolve: (userIds: string[], currentUserId?: string) => Promise<MattermostUser[]>;
};

export function createUserProfileResolver(
	api: MattermostApiClient,
	options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
): UserProfileResolver {
	const maxEntries = options.maxEntries ?? 500;
	const ttlMs = options.ttlMs ?? 10 * 60_000;
	const now = options.now ?? (() => Date.now());
	const cache = new Map<string, { user: MattermostUser; storedAt: number }>();
	const waiters = new Map<string, Array<(user?: MattermostUser) => void>>();
	let scheduled = false;

	function remember(user: MattermostUser) {
		cache.delete(user.id);
		cache.set(user.id, { user, storedAt: now() });
		while (cache.size > maxEntries) {
			const oldest = cache.keys().next();
			if (oldest.done) break;
			cache.delete(oldest.value);
		}
	}

	function get(userId: string) {
		const entry = cache.get(userId);
		if (!entry || now() - entry.storedAt > ttlMs) {
			cache.delete(userId);
			return undefined;
		}
		cache.delete(userId);
		cache.set(userId, entry);
		return entry.user;
	}

	function flush() {
		scheduled = false;
		const ids = [...waiters.keys()];
		if (!ids.length) return;
		void api
			.getUsersByIds(ids)
			.then((users) => {
				const byId = new Map(users.map((user) => [user.id, user]));
				for (const user of users) remember(user);
				for (const id of ids) {
					const callbacks = waiters.get(id) ?? [];
					waiters.delete(id);
					for (const callback of callbacks) callback(byId.get(id));
				}
			})
			.catch(() => {
				for (const id of ids) {
					const callbacks = waiters.get(id) ?? [];
					waiters.delete(id);
					for (const callback of callbacks) callback();
				}
			});
	}

	return {
		async resolve(userIds, currentUserId) {
			const ids = [...new Set(userIds.filter((id) => id && id !== currentUserId))];
			const resolved = new Map<string, MattermostUser>();
			const missing: string[] = [];
			for (const id of ids) {
				const user = get(id);
				if (user) resolved.set(id, user);
				else missing.push(id);
			}
			if (missing.length) {
				const pending = Promise.all(
					missing.map(
						(id) =>
							new Promise<void>((resolve) => {
								const callbacks = waiters.get(id) ?? [];
								callbacks.push((user) => {
									if (user) resolved.set(id, user);
									resolve();
								});
								waiters.set(id, callbacks);
							}),
					),
				);
				if (!scheduled) {
					scheduled = true;
					queueMicrotask(flush);
				}
				await pending;
			}
			return ids.flatMap((id) => {
				const user = resolved.get(id);
				return user ? [user] : [];
			});
		},
	};
}
