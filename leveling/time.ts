// Days, months and season resets all follow the server's own timezone (set on
// the dashboard), not the machine's, so "daily" rolls over at local midnight.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
    let f = formatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        formatters.set(tz, f);
    }
    return f;
}

export interface ZonedParts {
    year: number;
    month: number;   // 1-12
    day: number;
    hour: number;
    minute: number;
    second: number;
}

export function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

export function zonedParts(tz: string, ms: number = Date.now()): ZonedParts {
    const out: Record<string, number> = {};
    for (const part of formatter(tz).formatToParts(new Date(ms))) {
        if (part.type !== "literal") out[part.type] = Number(part.value);
    }
    return {
        year: out.year,
        month: out.month,
        day: out.day,
        hour: out.hour === 24 ? 0 : out.hour,
        minute: out.minute,
        second: out.second
    };
}

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

export function dayKey(tz: string, ms: number = Date.now()): string {
    const p = zonedParts(tz, ms);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function monthKey(tz: string, ms: number = Date.now()): string {
    const p = zonedParts(tz, ms);
    return `${p.year}-${pad(p.month)}`;
}

// Calendar arithmetic on a "YYYY-MM-DD" key. Done in UTC on purpose: the key
// is already local, so there is no timezone left to get wrong.
export function shiftDay(key: string, days: number): string {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// How far ahead of UTC the zone is at that instant, in ms.
function offsetAt(tz: string, ms: number): number {
    const p = zonedParts(tz, ms);
    const as_utc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return as_utc - Math.floor(ms / 1000) * 1000;
}

// The instant a wall clock in `tz` reads the given local time. Two passes
// settle the offset across a DST change.
export function zonedToUtc(tz: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    let ms = guess - offsetAt(tz, guess);
    ms = guess - offsetAt(tz, ms);
    return ms;
}

// Start of the local day `key` as an epoch ms.
export function dayStart(tz: string, key: string): number {
    const [y, m, d] = key.split("-").map(Number);
    return zonedToUtc(tz, y, m, d);
}
