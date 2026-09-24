// Shared value checkers.
//
// Everything the dashboard sends is run through these before it is stored, so
// a hand-crafted request can never leave behind a value the bot would choke on
// later — when a message is built out of it, possibly days afterwards, with
// nobody watching.
//
// They all take the current value as a fallback rather than throwing: a form
// that autosaves while somebody is still typing sends half-finished values all
// the time, and losing the rest of the page over one of them would be worse
// than quietly keeping what was there.

export const SNOWFLAKE = /^\d{15,21}$/;

export function num(v: unknown, fallback: number, min: number, max: number, integer = true): number {
    let n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n)) return fallback;
    if (integer) n = Math.trunc(n);
    else n = Math.round(n * 1000) / 1000;
    return Math.min(max, Math.max(min, n));
}

export function bool(v: unknown, fallback: boolean): boolean {
    return typeof v === "boolean" ? v : fallback;
}

export function str(v: unknown, fallback: string, max: number): string {
    return typeof v === "string" ? v.slice(0, max) : fallback;
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
    return options.includes(v as T) ? v as T : fallback;
}

export function id(v: unknown, fallback: string | null): string | null {
    if (v === null || v === "") return null;
    return typeof v === "string" && SNOWFLAKE.test(v) ? v : fallback;
}

export function ids(v: unknown, fallback: string[], max = 100): string[] {
    if (!Array.isArray(v)) return fallback;
    return [...new Set(v.filter((x): x is string => typeof x === "string" && SNOWFLAKE.test(x)))].slice(0, max);
}

export function color(v: unknown, fallback: string): string {
    return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

export function obj(v: unknown): Record<string, unknown> {
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
