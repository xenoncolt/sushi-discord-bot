import { Client, Status } from "discord.js";
import { createLevelingTable } from "../schema/levelingDB.js";
import { dayKey, dayStart, shiftDay } from "./time.js";


const db = createLevelingTable();

// While the bot is connected it writes a heartbeat every minute. A gap in
// the heartbeats (the process was down, or Discord couldn't be reached) is
// saved as downtime, and a day with enough downtime in it doesn't count
// against anyone's /daily streak: nobody could check in while the bot was
// gone, so nobody should lose their streak over it.

// Shorter gaps are just a restart for an update.
const GAP_MS = 5 * 60_000;
// How much of a day the bot must have missed before that day is forgiven.
const EXCUSE_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
// Outages older than this can't matter to a live streak any more.
const KEEP_MS = 400 * DAY_MS;

interface Outage {
    start: number;
    end: number;
}

let outages: Outage[] | null = null;

function loadOutages(): Outage[] {
    if (!outages) {
        outages = db.all<{ started_at: number; ended_at: number }[]>(`SELECT started_at, ended_at FROM downtime ORDER BY started_at`)
            .map(r => ({ start: r.started_at, end: r.ended_at }));
    }
    return outages;
}

export function getBotState(key: string): string | null {
    return db.get<{ value: string }>(`SELECT value FROM bot_state WHERE key = ?`, key)?.value ?? null;
}

export function setBotState(key: string, value: string | null): void {
    if (value === null) {
        db.run(`DELETE FROM bot_state WHERE key = ?`, key);
        return;
    }
    db.run(`INSERT INTO bot_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
}

// Every shard is up. While one is reconnecting the bot can't hear commands,
// and the voice channel lists it holds may be out of date.
export function isConnected(client: Client): boolean {
    return client.ws.shards.size > 0 && client.ws.shards.every(s => s.status === Status.Ready);
}

// Called every minute (and once at ready). Returns the outage it just closed,
// if the previous heartbeat was long enough ago to count as one.
export function heartbeat(client: Client, now: number = Date.now()): Outage | null {
    if (!isConnected(client)) return null;

    const last = Number(getBotState("heartbeat") ?? NaN);
    let closed: Outage | null = null;
    if (Number.isFinite(last) && now - last >= GAP_MS) {
        closed = { start: last, end: now };
        db.run(`INSERT INTO downtime (started_at, ended_at) VALUES (?, ?)`, last, now);
        db.run(`DELETE FROM downtime WHERE ended_at < ?`, now - KEEP_MS);
        outages = null;
        console.log(`The bot was offline for ${Math.round((now - last) / 60_000)} minutes; /daily streaks are protected for that time.`);
    }
    setBotState("heartbeat", String(now));
    return closed;
}

// Stamps the moment of a clean shutdown, so the downtime of a longer stop is
// measured from when the bot actually went away.
export function finalHeartbeat(client: Client): void {
    if (isConnected(client)) setBotState("heartbeat", String(Date.now()));
}

function downtimeOn(tz: string, day: string): number {
    const from = dayStart(tz, day);
    const to = dayStart(tz, shiftDay(day, 1));
    let total = 0;
    for (const o of loadOutages()) {
        if (o.end <= from || o.start >= to) continue;
        total += Math.min(o.end, to) - Math.max(o.start, from);
    }
    return total;
}

export function isExcusedDay(tz: string, day: string): boolean {
    return downtimeOn(tz, day) >= EXCUSE_MS;
}

// The oldest last check-in day that still keeps a streak alive today.
// Normally yesterday; each forgiven day right before today pushes it back.
export function streakFloor(tz: string, now: number = Date.now()): string {
    let floor = shiftDay(dayKey(tz, now), -1);
    for (let i = 0; i < 60 && isExcusedDay(tz, floor); i++) floor = shiftDay(floor, -1);
    return floor;
}
