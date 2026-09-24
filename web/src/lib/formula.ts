// Same curve as leveling/formula.ts in the bot, for the "View Details" table.

export interface Formula {
	multiplier: number;
	offset: number;
	divider: number;
}

export function xpForLevel(level: number, f: Formula): number {
	if (level <= 0) return 0;
	if (!(f.multiplier > 0) || !(f.divider > 0)) return 0;
	return Math.max(0, Math.floor((Math.pow(f.divider * level, 2) - f.offset) / f.multiplier) + 1);
}

export function fmt(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

export function timeAgo(ms: number): string {
	const s = Math.round((Date.now() - ms) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

export function dateTime(ms: number): string {
	return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
