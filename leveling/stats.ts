import { createLevelingTable } from "../schema/levelingDB.js";
import { getSettings } from "./settings.js";
import { dayKey, shiftDay, zonedParts } from "./time.js";


const db = createLevelingTable();

// Counting straight into SQLite would mean a write for every chat message.
// Counts pile up here instead and are flushed once a minute.
interface Counts {
    messages: number;
    voice_minutes: number;
    xp: number;
}

interface Bucket extends Counts {
    active: Set<string>;
    joins: number;
    leaves: number;
    member_count: number | null;
    hours: Map<string, Counts>;
    channels: Map<string, { messages: number; xp: number }>;
}

const pending = new Map<string, Bucket>();

function zero(): Counts {
    return { messages: 0, voice_minutes: 0, xp: 0 };
}

function bucket(guild_id: string): { b: Bucket; hour: Counts } {
    const tz = getSettings(guild_id).server.timezone;
    const now = Date.now();
    const day = dayKey(tz, now);
    const key = `${guild_id}|${day}`;
    let b = pending.get(key);
    if (!b) {
        b = { ...zero(), active: new Set(), joins: 0, leaves: 0, member_count: null, hours: new Map(), channels: new Map() };
        pending.set(key, b);
    }
    const hour_key = `${day} ${String(zonedParts(tz, now).hour).padStart(2, "0")}`;
    let hour = b.hours.get(hour_key);
    if (!hour) {
        hour = zero();
        b.hours.set(hour_key, hour);
    }
    return { b, hour };
}

function channelCounts(b: Bucket, channel_id: string) {
    let c = b.channels.get(channel_id);
    if (!c) {
        c = { messages: 0, xp: 0 };
        b.channels.set(channel_id, c);
    }
    return c;
}

export function recordMessage(guild_id: string, user_id: string, channel_id: string): void {
    const { b, hour } = bucket(guild_id);
    b.messages++;
    hour.messages++;
    b.active.add(user_id);
    channelCounts(b, channel_id).messages++;
}

export function recordVoiceMinute(guild_id: string, user_id: string): void {
    const { b, hour } = bucket(guild_id);
    b.voice_minutes++;
    hour.voice_minutes++;
    b.active.add(user_id);
}

export function recordXpEarned(guild_id: string, amount: number, channel_id?: string | null): void {
    if (amount <= 0) return;
    const { b, hour } = bucket(guild_id);
    b.xp += amount;
    hour.xp += amount;
    if (channel_id) channelCounts(b, channel_id).xp += amount;
}

export function recordJoin(guild_id: string): void {
    bucket(guild_id).b.joins++;
}

export function recordLeave(guild_id: string): void {
    bucket(guild_id).b.leaves++;
}

// The server's size today, for the "Server Members" graph.
export function recordMemberCount(guild_id: string, count: number): void {
    bucket(guild_id).b.member_count = count;
}

export function flushStats(): void {
    if (pending.size === 0) return;
    const batch = [...pending.entries()];
    pending.clear();

    for (const [key, b] of batch) {
        const [guild_id, day] = key.split("|");
        try {
            for (const user_id of b.active) {
                db.run(`INSERT OR IGNORE INTO stats_active (guild_id, day, user_id) VALUES (?, ?, ?)`, guild_id, day, user_id);
            }
            const active = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM stats_active WHERE guild_id = ? AND day = ?`, guild_id, day)?.n ?? 0;
            db.run(
                `INSERT INTO stats_daily (guild_id, day, messages, voice_minutes, xp, active_users, joins, leaves, member_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, day) DO UPDATE SET
                    messages = messages + excluded.messages,
                    voice_minutes = voice_minutes + excluded.voice_minutes,
                    xp = xp + excluded.xp,
                    active_users = excluded.active_users,
                    joins = joins + excluded.joins,
                    leaves = leaves + excluded.leaves,
                    member_count = COALESCE(excluded.member_count, member_count)`,
                guild_id, day, b.messages, b.voice_minutes, b.xp, active, b.joins, b.leaves, b.member_count
            );
            for (const [hour, c] of b.hours) {
                db.run(
                    `INSERT INTO stats_hourly (guild_id, hour, messages, voice_minutes, xp) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(guild_id, hour) DO UPDATE SET
                        messages = messages + excluded.messages,
                        voice_minutes = voice_minutes + excluded.voice_minutes,
                        xp = xp + excluded.xp`,
                    guild_id, hour, c.messages, c.voice_minutes, c.xp
                );
            }
            for (const [channel_id, c] of b.channels) {
                db.run(
                    `INSERT INTO stats_channel (guild_id, day, channel_id, messages, xp) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(guild_id, day, channel_id) DO UPDATE SET
                        messages = messages + excluded.messages,
                        xp = xp + excluded.xp`,
                    guild_id, day, channel_id, c.messages, c.xp
                );
            }
        } catch (err) {
            console.error(`Failed to flush stats for ${key}:`, err);
        }
    }
}

// Per-user rows are only needed to count distinct users per day; once a day
// is over the count is already in stats_daily, so old rows can go.
export function pruneStats(): void {
    const iso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    db.run(`DELETE FROM stats_active WHERE day < ?`, iso(3));
    db.run(`DELETE FROM stats_hourly WHERE hour < ?`, iso(3));
    db.run(`DELETE FROM stats_daily WHERE day < ?`, iso(400));
    db.run(`DELETE FROM stats_channel WHERE day < ?`, iso(400));
}

export type StatsRange = "day" | "week" | "month" | "year";

export interface StatsPoint {
    label: string;
    messages: number;
    voice_hours: number;
    xp: number;
    active_users: number | null;
    members: number | null;
}

export interface ChannelStat {
    channel_id: string;
    messages: number;
    xp: number;
}

export interface StatsSummary {
    messages: number;
    voice_hours: number;
    xp: number;
    avg_active_users: number;
    member_change: number;
    joins: number;
    leaves: number;
    member_count: number;
    points: StatsPoint[];
    channels: ChannelStat[];
}

type DailyRow = { day: string; messages: number; voice_minutes: number; xp: number; active_users: number; joins: number; leaves: number; member_count: number | null };

const hours1 = (minutes: number) => Math.round(minutes / 6) / 10;

export function getStats(guild_id: string, range: StatsRange, member_count: number): StatsSummary {
    flushStats();

    const today = dayKey(getSettings(guild_id).server.timezone);
    const days = range === "day" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 365;
    const first = shiftDay(today, -(days - 1));

    const rows = db.all<DailyRow[]>(
        `SELECT day, messages, voice_minutes, xp, active_users, joins, leaves, member_count FROM stats_daily
         WHERE guild_id = ? AND day >= ? AND day <= ? ORDER BY day`,
        guild_id, first, today
    );
    const by_day = new Map(rows.map(r => [r.day, r]));

    const points: StatsPoint[] = [];
    if (range === "day") {
        const hourly = db.all<{ hour: string; messages: number; voice_minutes: number; xp: number }[]>(
            `SELECT hour, messages, voice_minutes, xp FROM stats_hourly WHERE guild_id = ? AND hour >= ? AND hour <= ?`,
            guild_id, `${today} 00`, `${today} 23`
        );
        const by_hour = new Map(hourly.map(h => [h.hour, h]));
        for (let h = 0; h < 24; h++) {
            const label = `${today} ${String(h).padStart(2, "0")}`;
            const r = by_hour.get(label);
            points.push({ label, messages: r?.messages ?? 0, voice_hours: hours1(r?.voice_minutes ?? 0), xp: r?.xp ?? 0, active_users: null, members: null });
        }
    } else if (range === "year") {
        // A year of daily points is unreadable as a chart; months read fine.
        const months = new Map<string, { messages: number; voice: number; xp: number; active: number; days: number; members: number | null }>();
        for (let i = 0; i < days; i++) {
            const day = shiftDay(first, i);
            const m = day.slice(0, 7);
            const r = by_day.get(day);
            const agg = months.get(m) ?? { messages: 0, voice: 0, xp: 0, active: 0, days: 0, members: null };
            agg.messages += r?.messages ?? 0;
            agg.voice += r?.voice_minutes ?? 0;
            agg.xp += r?.xp ?? 0;
            agg.active += r?.active_users ?? 0;
            agg.days++;
            if (r?.member_count != null) agg.members = r.member_count;
            months.set(m, agg);
        }
        for (const [m, agg] of months) {
            points.push({ label: m, messages: agg.messages, voice_hours: hours1(agg.voice), xp: agg.xp, active_users: Math.round(agg.active / agg.days), members: agg.members });
        }
    } else {
        for (let i = 0; i < days; i++) {
            const day = shiftDay(first, i);
            const r = by_day.get(day);
            points.push({
                label: day,
                messages: r?.messages ?? 0,
                voice_hours: hours1(r?.voice_minutes ?? 0),
                xp: r?.xp ?? 0,
                active_users: r?.active_users ?? 0,
                members: r?.member_count ?? null
            });
        }
    }

    const channels = db.all<ChannelStat[]>(
        `SELECT channel_id, SUM(messages) AS messages, SUM(xp) AS xp FROM stats_channel
         WHERE guild_id = ? AND day >= ? AND day <= ? GROUP BY channel_id
         ORDER BY messages DESC LIMIT 25`,
        guild_id, first, today
    );

    // Averaged from the first recorded day, so a server that only just added
    // the bot isn't dragged down by days before it was tracking anything.
    const tracked_days = rows.length
        ? Math.round((Date.parse(today) - Date.parse(rows[0].day)) / 86_400_000) + 1
        : 1;

    const sum = (f: (r: DailyRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const joins = sum(r => r.joins);
    const leaves = sum(r => r.leaves);
    return {
        messages: sum(r => r.messages),
        voice_hours: Math.round(sum(r => r.voice_minutes) / 60),
        xp: sum(r => r.xp),
        avg_active_users: rows.length ? Math.round(sum(r => r.active_users) / tracked_days) : 0,
        member_change: joins - leaves,
        joins,
        leaves,
        member_count,
        points,
        channels
    };
}
