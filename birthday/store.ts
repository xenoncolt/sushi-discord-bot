import { createLevelingTable } from "../schema/levelingDB.js";
import { zonedParts } from "../leveling/time.js";


const db = createLevelingTable();

export interface BirthdayRow {
    guild_id: string;
    user_id: string;
    month: number;
    day: number;
    // Optional on purpose: nobody is made to hand over their age to take part.
    year: number | null;
    updated_at: number;
}

export const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

export function isLeap(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(month: number, year = 2024): number {
    return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

// 29 February exists one year in four. Everyone born on it is celebrated on
// the 28th in a common year, so they never go a year without an announcement.
function effectiveDay(month: number, day: number, year: number): number {
    return month === 2 && day === 29 && !isLeap(year) ? 28 : day;
}

export function formatDate(month: number, day: number): string {
    return `${day} ${MONTHS[month - 1]}`;
}

// Whole years old on the given date. On the birthday itself that is exact;
// before it in the same year it is one less.
export function ageOn(year: number, month: number, day: number, on: { year: number; month: number; day: number }): number {
    const had = on.month > month || (on.month === month && on.day >= day);
    return on.year - year - (had ? 0 : 1);
}


// ---- reading & writing -------------------------------------------------------

export function getBirthday(guild_id: string, user_id: string): BirthdayRow | undefined {
    return db.get<BirthdayRow>(`SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?`, guild_id, user_id);
}

export function setBirthday(guild_id: string, user_id: string, month: number, day: number, year: number | null): void {
    db.run(
        `INSERT INTO birthdays (guild_id, user_id, month, day, year, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET month = excluded.month, day = excluded.day, year = excluded.year, updated_at = excluded.updated_at`,
        guild_id, user_id, month, day, year, Date.now()
    );
}

export function removeBirthday(guild_id: string, user_id: string): boolean {
    return db.run(`DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?`, guild_id, user_id).changes > 0;
}

export function countBirthdays(guild_id: string): number {
    return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM birthdays WHERE guild_id = ?`, guild_id)?.n ?? 0;
}

export function listBirthdays(guild_id: string): BirthdayRow[] {
    return db.all<BirthdayRow[]>(`SELECT * FROM birthdays WHERE guild_id = ? ORDER BY month, day`, guild_id);
}

// Everyone whose birthday falls on that date, 29 February included when the
// year has no 29th.
export function birthdaysOn(guild_id: string, year: number, month: number, day: number): BirthdayRow[] {
    const rows = db.all<BirthdayRow[]>(
        `SELECT * FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?`,
        guild_id, month, day
    );
    if (month === 2 && day === 28 && !isLeap(year)) {
        rows.push(...db.all<BirthdayRow[]>(`SELECT * FROM birthdays WHERE guild_id = ? AND month = 2 AND day = 29`, guild_id));
    }
    return rows;
}

export interface UpcomingRow extends BirthdayRow {
    in_days: number;
    age: number | null;
}

// Sorted by how soon it is, wrapping around the end of the year.
export function upcomingBirthdays(guild_id: string, tz: string, limit = 10): UpcomingRow[] {
    const now = zonedParts(tz);
    const today = Date.UTC(now.year, now.month - 1, now.day);

    return listBirthdays(guild_id)
        .map(row => {
            let on_year = now.year;
            let at = Date.UTC(on_year, row.month - 1, effectiveDay(row.month, row.day, on_year));
            if (at < today) {
                on_year++;
                at = Date.UTC(on_year, row.month - 1, effectiveDay(row.month, row.day, on_year));
            }
            return {
                ...row,
                in_days: Math.round((at - today) / 86_400_000),
                // The age they are turning, not the age they are now.
                age: row.year === null ? null : on_year - row.year
            };
        })
        .sort((a, b) => a.in_days - b.in_days || a.user_id.localeCompare(b.user_id))
        .slice(0, limit);
}


// ---- parsing what people type -------------------------------------------------

const MONTH_WORDS = new Map<string, number>();
for (const [i, name] of MONTHS.entries()) {
    MONTH_WORDS.set(name.toLowerCase(), i + 1);
    MONTH_WORDS.set(name.toLowerCase().slice(0, 3), i + 1);
}
MONTH_WORDS.set("sept", 9);

export interface ParsedBirthday {
    month: number;
    day: number;
    year: number | null;
}

// Accepts "5-11", "05/11", "25 dec", "Dec 25", "5 Nov 2000" and friends. Two
// plain numbers are read as day-month, except when only one of them can be a
// month — "12-25" is the 25th of December, not the 12th of month 25.
export function parseBirthday(date_text: string, year_text = ""): ParsedBirthday | string {
    const cleaned = date_text.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/[^\p{L}\d]+/gu, " ").trim();
    if (!cleaned) return "Type the day and month, for example `05-11` or `5 Nov`.";

    let month: number | null = null;
    const numbers: number[] = [];
    for (const token of cleaned.split(" ")) {
        if (/^\d+$/.test(token)) {
            numbers.push(Number(token));
            continue;
        }
        const named = MONTH_WORDS.get(token);
        if (named === undefined) return `I don't understand "${token}". Try something like \`05-11\` or \`5 Nov\`.`;
        if (month !== null) return "That looks like two months. Type one day and one month.";
        month = named;
    }

    let day: number | null = null;
    let year: number | null = null;

    // Only a four-digit number is read as a year, so "32-01" is a bad day
    // rather than the year 32 and a month with nothing in front of it.
    const long = numbers.findIndex(n => n >= 1000);
    if (long >= 0) year = numbers.splice(long, 1)[0];

    if (month !== null) {
        if (numbers.length !== 1) return "Type one day together with the month, like `5 Nov`.";
        day = numbers[0];
    } else if (numbers.length === 3) {
        // Nothing left over should reach here, but be forgiving: the last
        // number is the year when it wasn't already taken above.
        year ??= numbers.pop()!;
        [day, month] = orderDayMonth(numbers[0], numbers[1]);
    } else if (numbers.length === 2) {
        [day, month] = orderDayMonth(numbers[0], numbers[1]);
    } else {
        return "Type both a day and a month, for example `05-11` or `5 Nov`.";
    }

    if (month === null || month < 1 || month > 12) return "That month doesn't exist. Use 1-12 or a name like `Nov`.";
    if (day < 1) return "The day has to be 1 or more.";
    if (day > daysInMonth(month)) return `${MONTHS[month - 1]} only has ${daysInMonth(month)} days.`;

    const typed_year = year_text.trim();
    if (typed_year) {
        if (!/^\d{4}$/.test(typed_year)) return "The year has to be four digits, like `2000`. Leave it empty to keep your age private.";
        year = Number(typed_year);
    }

    if (year !== null) {
        const this_year = new Date().getUTCFullYear();
        if (year > this_year || year < this_year - 120) return `The year has to be between ${this_year - 120} and ${this_year}.`;
        if (month === 2 && day === 29 && !isLeap(year)) return `${year} wasn't a leap year, so it had no 29 February.`;
    }

    return { month, day, year };
}

// Which of the two numbers is the day. Ambiguous pairs are read day-first;
// the reply always spells the month out so a mix-up is obvious.
function orderDayMonth(a: number, b: number): [number, number] {
    if (a > 12 && b <= 12) return [a, b];
    if (b > 12 && a <= 12) return [b, a];
    return [a, b];
}
