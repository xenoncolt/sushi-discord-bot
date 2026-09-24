import { api, type Me } from "./api";

export const session = $state<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });

let pending: Promise<Me | null> | null = null;

export function loadMe(force = false): Promise<Me | null> {
	if (pending && !force) return pending;
	pending = api<Me>("/me")
		.then(me => {
			session.me = me;
			return me;
		})
		.catch(() => null)
		.finally(() => {
			session.loaded = true;
		});
	return pending;
}

export function loginUrl(next: string = location.pathname + location.search): string {
	return `/api/auth/login?next=${encodeURIComponent(next)}`;
}

export async function logout(): Promise<void> {
	await api("/auth/logout", { method: "POST" }).catch(() => {});
	session.me = session.me ? { ...session.me, user: null } : null;
	location.href = "/";
}
