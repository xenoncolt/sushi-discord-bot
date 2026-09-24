import { createLevelingTable } from "../schema/levelingDB.js";
import { levelForXp } from "./formula.js";
import { getSettings } from "./settings.js";
import { dayKey, monthKey, shiftDay } from "./time.js";
import { streakFloor } from "./uptime.js";


const db = createLevelingTable();

export interface MemberRow {
    guild_id: string;
    user_id: string;
    xp: number;
    level: number;
    month_key: string | null;
    month_xp: number;
    att_total: number;
    att_streak: number;
    att_last: string | null;
    bonus_last: string | null;
    name: string | null;
    avatar: string | null;
    updated_at: number;
}

export interface Profile {
    name?: string | null;
    avatar?: string | null;
}

export interface XpResult {
    old_xp: number;
    xp: number;
    old_level: number;
    level: number;
    applied: number;
}

function blank(guild_id: string, user_id: string): MemberRow {
    return {
        guild_id, user_id,
        xp: 0, level: 0,
        month_key: null, month_xp: 0,
        att_total: 0, att_streak: 0, att_last: null,
        bonus_last: null,
        name: null, avatar: null,
        updated_at: 0
    };
}

export function getMember(guild_id: string, user_id: string): MemberRow {
    return db.get<MemberRow>(`SELECT * FROM members WHERE guild_id = ? AND user_id = ?`, guild_id, user_id)
        ?? blank(guild_id, user_id);
}

function save(row: MemberRow): void {
    db.run(
        `INSERT INTO members (guild_id, user_id, xp, level, month_key, month_xp, att_total, att_streak, att_last, bonus_last, name, avatar, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
            xp = excluded.xp, level = excluded.level,
            month_key = excluded.month_key, month_xp = excluded.month_xp,
            att_total = excluded.att_total, att_streak = excluded.att_streak, att_last = excluded.att_last,
            bonus_last = excluded.bonus_last,
            name = excluded.name, avatar = excluded.avatar,
            updated_at = excluded.updated_at`,
        row.guild_id, row.user_id, row.xp, row.level, row.month_key, row.month_xp,
        row.att_total, row.att_streak, row.att_last, row.bonus_last, row.name, row.avatar, row.updated_at
    );
}

function withProfile(row: MemberRow, profile?: Profile): MemberRow {
    if (profile?.name) row.name = profile.name;
    if (profile?.avatar !== undefined && profile.avatar !== null) row.avatar = profile.avatar;
    return row;
}

export type XpGainListener = (guild_id: string, user_id: string, xp: number) => void;

const gain_listeners: XpGainListener[] = [];

// Hears every XP increase, right after it is saved (loans use it to collect an
// overdue debt the moment the borrower can pay). Listeners may run inside the
// caller's transaction, so they must only look and schedule, never write.
export function onXpGain(listener: XpGainListener): void {
    gain_listeners.push(listener);
}

// The one place XP changes. Reads and writes in the same tick, and node:sqlite
// is synchronous, so two changes can never interleave and lose an update.
// Balance never goes below zero; `applied` is what actually moved.
export function applyXp(guild_id: string, user_id: string, delta: number, profile?: Profile): XpResult {
    const settings = getSettings(guild_id);
    const row = withProfile(getMember(guild_id, user_id), profile);
    const month = monthKey(settings.server.timezone);

    const old_xp = row.xp;
    const old_level = row.level;
    const xp = Math.max(0, Math.round(old_xp + delta));
    const applied = xp - old_xp;

    row.month_xp = Math.max(0, (row.month_key === month ? row.month_xp : 0) + applied);
    row.month_key = month;
    row.xp = xp;
    row.level = levelForXp(xp, settings.server.formula);
    row.updated_at = Date.now();
    save(row);

    if (applied > 0) {
        for (const listener of gain_listeners) {
            try {
                listener(guild_id, user_id, xp);
            } catch (err) {
                console.error("XP gain listener failed:", err);
            }
        }
    }

    return { old_xp, xp, old_level, level: row.level, applied };
}

export function setXp(guild_id: string, user_id: string, xp: number, profile?: Profile): XpResult {
    const current = getMember(guild_id, user_id);
    return applyXp(guild_id, user_id, Math.max(0, Math.round(xp)) - current.xp, profile);
}

export function touchProfile(guild_id: string, user_id: string, profile: Profile): void {
    db.run(
        `UPDATE members SET name = COALESCE(?, name), avatar = COALESCE(?, avatar) WHERE guild_id = ? AND user_id = ?`,
        profile.name ?? null, profile.avatar ?? null, guild_id, user_id
    );
}

export type AttendanceOutcome =
    | { claimed: false; next_day: string }
    | { claimed: true; total: number; streak: number; continued: boolean };

// /daily. Counts one check-in per local day; the streak carries on only if
// the previous check-in was yesterday (or before a day the bot was offline
// for, see uptime.ts).
export function checkIn(guild_id: string, user_id: string, profile?: Profile): AttendanceOutcome {
    const tz = getSettings(guild_id).server.timezone;
    const today = dayKey(tz);
    const row = withProfile(getMember(guild_id, user_id), profile);

    if (row.att_last === today) {
        return { claimed: false, next_day: shiftDay(today, 1) };
    }

    const continued = row.att_last !== null && row.att_last >= streakFloor(tz);
    row.att_streak = continued ? row.att_streak + 1 : 1;
    row.att_total += 1;
    row.att_last = today;
    row.updated_at = Date.now();
    save(row);

    return { claimed: true, total: row.att_total, streak: row.att_streak, continued };
}

// /bonus. Once per local day.
export function claimBonus(guild_id: string, user_id: string): boolean {
    const today = dayKey(getSettings(guild_id).server.timezone);
    const row = getMember(guild_id, user_id);
    if (row.bonus_last === today) return false;

    row.bonus_last = today;
    save(row);
    return true;
}

// A streak is only "current" while the last check-in was today or yesterday
// (days the bot was offline for don't count as missed).
export function liveStreak(row: Pick<MemberRow, "att_streak" | "att_last">, tz: string): number {
    if (!row.att_last) return 0;
    return row.att_last >= streakFloor(tz) ? row.att_streak : 0;
}

export function liveMonthXp(row: Pick<MemberRow, "month_xp" | "month_key">, tz: string): number {
    return row.month_key === monthKey(tz) ? row.month_xp : 0;
}

export function xpRank(guild_id: string, user_id: string): number {
    const row = getMember(guild_id, user_id);
    const ahead = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND (xp > ? OR (xp = ? AND user_id < ?))`,
        guild_id, row.xp, row.xp, user_id
    )?.n ?? 0;
    return ahead + 1;
}

export function monthRank(guild_id: string, user_id: string): number {
    const tz = getSettings(guild_id).server.timezone;
    const month = monthKey(tz);
    const mine = liveMonthXp(getMember(guild_id, user_id), tz);
    const ahead = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND month_key = ? AND (month_xp > ? OR (month_xp = ? AND user_id < ?))`,
        guild_id, month, mine, mine, user_id
    )?.n ?? 0;
    return ahead + 1;
}

// After the level formula changes every stored level is stale.
export function recomputeLevels(guild_id: string): void {
    const formula = getSettings(guild_id).server.formula;
    const rows = db.all<{ user_id: string; xp: number; level: number }[]>(
        `SELECT user_id, xp, level FROM members WHERE guild_id = ?`, guild_id
    );
    for (const r of rows) {
        const level = levelForXp(r.xp, formula);
        if (level !== r.level) {
            db.run(`UPDATE members SET level = ? WHERE guild_id = ? AND user_id = ?`, level, guild_id, r.user_id);
        }
    }
}

export function deleteMember(guild_id: string, user_id: string): void {
    db.run(`DELETE FROM members WHERE guild_id = ? AND user_id = ?`, guild_id, user_id);
}

export function allMemberIds(guild_id: string): string[] {
    return db.all<{ user_id: string }[]>(`SELECT user_id FROM members WHERE guild_id = ?`, guild_id).map(r => r.user_id);
}

export function resetXp(guild_id: string): void {
    db.run(`UPDATE members SET xp = 0, level = 0, month_xp = 0 WHERE guild_id = ?`, guild_id);
}

export function resetAttendance(guild_id: string): void {
    db.run(`UPDATE members SET att_total = 0, att_streak = 0, att_last = NULL WHERE guild_id = ?`, guild_id);
}
